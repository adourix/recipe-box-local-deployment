import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { enqueueJob, triggerWorker } from "@/lib/queue";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const key = process.env.EDIT_KEY;
  return Boolean(key) && req.headers.get("x-edit-key") === key;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { data, error } = await supabaseAdmin()
    .from("recipes")
    .select("source_url,status")
    .eq("id", id)
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (data.status === "ok") {
    return NextResponse.json({ ok: true, already_complete: true });
  }
  if (!data.source_url || !/^https?:\/\//.test(data.source_url)) {
    return NextResponse.json({ error: "no source" }, { status: 400 });
  }

  await enqueueJob(data.source_url, null);
  await triggerWorker();
  return NextResponse.json({ ok: true, queued: true }, { status: 202 });
}
