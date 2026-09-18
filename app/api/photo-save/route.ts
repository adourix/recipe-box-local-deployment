import { NextRequest, NextResponse } from "next/server";
import { saveFromImage } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const key = process.env.EDIT_KEY;
  return Boolean(key) && req.headers.get("x-edit-key") === key;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const caption = String(form?.get("caption") || "") || undefined;
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return NextResponse.json({error: "unsupported image"}, {status: 415});
  if (!file.size || file.size > 12 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const r = await saveFromImage(buf, file.type || "image/jpeg", { caption });
    if (r.duplicate) {
      return NextResponse.json({ error: "duplicate", ...r }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("photo-save failed", e);
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }
}
