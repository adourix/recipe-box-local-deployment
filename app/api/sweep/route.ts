import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { enqueueJob, triggerWorker, pendingCount } from "@/lib/queue";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const cron = process.env.CRON_SECRET;
  if (cron && req.headers.get("authorization") === `Bearer ${cron}`) return true;
  return req.headers.get("x-edit-key") === process.env.EDIT_KEY;
}

// Daily self-heal: re-queue incomplete recipes (transient failures fix themselves).
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("recipes")
    .select("source_url")
    .in("status", ["needs_review", "fetch_failed"])
    .limit(30);

  let requeued = 0;
  for (const r of data || []) {
    const u = r.source_url as string;
    if (u && u !== "video-upload" && u !== "photo-upload" && /^https?:\/\//.test(u)) {
      await enqueueJob(u, null); // null chat = silent (no Telegram spam)
      requeued++;
    }
  }
  // Also nudge the worker if anything is already waiting (recovers a stalled queue).
  if (requeued || (await pendingCount()) > 0) await triggerWorker();
  return NextResponse.json({ ok: true, requeued });
}
