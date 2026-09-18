import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const key = process.env.EDIT_KEY;
  if (!key) return false;
  return req.headers.get("x-edit-key") === key;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return NextResponse.json({error: "unsupported image"}, {status: 415});
  if (!file.size || file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large" }, { status: 400 });
  }

  const ct = file.type || "image/jpeg";
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const path = `${id}-${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const sb = supabaseAdmin();
  const { error: upErr } = await sb.storage
    .from("recipe-images")
    .upload(path, buf, { contentType: ct, upsert: true });
  if (upErr) {
    console.error("image upload failed", upErr);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  const publicUrl = sb.storage.from("recipe-images").getPublicUrl(path).data.publicUrl;

  const { error } = await sb
    .from("recipes")
    .update({ image_url: publicUrl })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, image_url: publicUrl });
}
