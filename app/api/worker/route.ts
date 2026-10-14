import { NextRequest, NextResponse } from "next/server";
import { runInBackground } from "@/lib/background";
import { saveFromUrl, sendSaveResult } from "@/lib/pipeline";
import { sendMessage } from "@/lib/telegram";
import {
  acquireLock,
  renewLock,
  releaseLock,
  claimNextJob,
  markJobDone,
  markJobError,
  pendingCount,
  purgeOldJobs,
  reclaimStale,
  triggerWorker,
} from "@/lib/queue";

export const runtime = "nodejs";
export const maxDuration = 300;

// Spacing between jobs keeps us under Gemini's per-minute limit. Keep the budget
// low enough that even a worst-case job (a 3-minute reel: download + Files API
// upload + transcription runs ~60s) finishes before maxDuration, so the function
// never gets hard-killed while holding the lock. It re-triggers itself to drain
// the rest.
const GAP_MS = 2500;
const BUDGET_MS = 60_000;

function workerSecret(): string {
  return process.env.WORKER_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET || "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  const secret = workerSecret();
  if (!secret || req.headers.get("x-internal-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Only one worker runs at a time (serialises all Gemini calls).
  if (!(await acquireLock())) {
    return NextResponse.json({ ok: true, skipped: "locked" });
  }

  runInBackground(
    (async () => {
      const deadline = Date.now() + BUDGET_MS;
      await purgeOldJobs().catch(() => {});
      // We hold the exclusive lock, so any 'processing' job is orphaned — reclaim it.
      await reclaimStale().catch(() => {});
      try {
        while (Date.now() < deadline) {
          await renewLock();
          const job = await claimNextJob();
          if (!job) break;
          try {
            console.info("[recipe-worker] started", { jobId: job.id, attempts: job.attempts });
            const r = await saveFromUrl(job.url);
            if (job.chat_id) await sendSaveResult(job.chat_id, r);
            await markJobDone(job.id);
            console.info("[recipe-worker] finished", { jobId: job.id, recipeId: r.id, status: r.status });
          } catch (e) {
            await markJobError(job.id, String(e));
            console.error("[recipe-worker] failed", { jobId: job.id, error: String(e) });
            if (job.chat_id) await sendMessage(job.chat_id, "⚠️ تعذّر حفظ أحد الروابط.");
          }
          await sleep(GAP_MS);
        }
      } finally {
        await releaseLock();
        // Hand off any leftover work to a fresh worker invocation.
        if ((await pendingCount()) > 0) await triggerWorker();
      }
    })()
  );

  return NextResponse.json({ ok: true });
}
