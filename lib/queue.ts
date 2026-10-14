import { supabaseAdmin } from "./supabase";
import { fetchWithTimeout } from "./http";

function workerSecret(): string {
  return process.env.WORKER_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET || "";
}

export interface Job {
  id: string;
  url: string;
  chat_id: number | null;
  attempts: number;
}

export interface JobReceipt {
  id: string;
  status: string;
  created_at: string;
}

// Longer than the slowest single job (~2min for a long reel), so the lease never
// expires mid-job and lets a second worker in.
const LEASE_MS = 180_000;

export async function enqueueJob(url: string, chatId: number | null): Promise<JobReceipt> {
  const { data, error } = await supabaseAdmin()
    .from("jobs")
    .insert({ url, chat_id: chatId })
    .select("id,status,created_at")
    .single();
  if (error || !data) throw new Error(error?.message || "job enqueue failed");
  return data as JobReceipt;
}

export async function pendingCount(): Promise<number> {
  const { count } = await supabaseAdmin()
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count || 0;
}

async function statusCount(status: string): Promise<number> {
  const { count } = await supabaseAdmin()
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", status);
  return count || 0;
}

export async function queueStatus(): Promise<{ pending: number; processing: number }> {
  const [pending, processing] = await Promise.all([
    statusCount("pending"),
    statusCount("processing"),
  ]);
  return { pending, processing };
}

/** Reset orphaned 'processing' jobs (worker died mid-job) back to pending.
 * Safe to call only while holding the worker lock (we're the sole worker). */
export async function reclaimStale(): Promise<void> {
  // Recover only jobs whose last update is older than the lease window. This
  // prevents a second worker from resetting a job while the first is active.
  const cutoff = new Date(Date.now() - LEASE_MS).toISOString();
  await supabaseAdmin()
    .from("jobs")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("status", "processing")
    .lt("updated_at", cutoff);
}

/** Acquire the single global worker lease. Returns true if we own it. */
export async function acquireLock(): Promise<boolean> {
  const sb = supabaseAdmin();
  const until = new Date(Date.now() + LEASE_MS).toISOString();
  const now = new Date().toISOString();
  const { data } = await sb
    .from("worker_lock")
    .update({ locked_until: until })
    .eq("id", 1)
    .or(`locked_until.is.null,locked_until.lt.${now}`)
    .select();
  return Boolean(data && data.length);
}

export async function renewLock(): Promise<void> {
  await supabaseAdmin()
    .from("worker_lock")
    .update({ locked_until: new Date(Date.now() + LEASE_MS).toISOString() })
    .eq("id", 1);
}

export async function releaseLock(): Promise<void> {
  await supabaseAdmin().from("worker_lock").update({ locked_until: null }).eq("id", 1);
}

/** Claim the oldest pending job (conditional update guards against races). */
export async function claimNextJob(): Promise<Job | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("jobs")
    .select("id, url, chat_id, attempts")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);
  const job = data?.[0] as Job | undefined;
  if (!job) return null;
  const { data: upd } = await sb
    .from("jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id");
  return upd && upd.length ? job : null;
}

export async function markJobDone(id: string): Promise<void> {
  await supabaseAdmin().from("jobs").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", id);
}

export async function markJobError(id: string, msg: string): Promise<void> {
  await supabaseAdmin().from("jobs").update({ status: "error", error: msg.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", id);
}

/** Housekeeping: drop finished jobs older than a day. */
export async function purgeOldJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await supabaseAdmin()
    .from("jobs")
    .delete()
    .in("status", ["done", "error"])
    .lt("created_at", cutoff);
}

/** Fire the worker endpoint (returns immediately; it processes in the background). */
export async function triggerWorker(): Promise<void> {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (!base) return;
  try {
    await fetchWithTimeout(`${base}/api/worker`, {
      method: "POST",
      headers: { "x-internal-secret": workerSecret() },
    }, 10_000);
  } catch {
    /* fire and forget */
  }
}

/**
 * Give the newest failed import one immediate, one-time retry when the gallery
 * is next opened. This repairs transient social-link failures without waiting
 * for the nightly sweep and without re-enqueueing on every page view.
 */
export async function autoRetryLatestFailure(): Promise<void> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("recipes")
    .select("id,source_url")
    .eq("status", "fetch_failed")
    .order("created_at", { ascending: false })
    .limit(1);
  const recipe = data?.[0];
  const url = recipe?.source_url as string | undefined;
  if (!recipe?.id || !url || !/^https?:\/\//.test(url)) return;

  // The unique key makes concurrent gallery requests collapse to one retry.
  const { error } = await sb.from("app_kv").insert({
    key: `auto_retry_recipe_${recipe.id}`,
    ts: new Date().toISOString(),
  });
  if (error) return;

  await enqueueJob(url, null);
  await triggerWorker();
}
