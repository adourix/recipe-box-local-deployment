import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { classifyRecipeTags } from "@/lib/tags";

export const runtime = "nodejs";
export const maxDuration = 60;

// Content-aware backfill: normalize old tags and add missing stable categories.
export async function POST(req: NextRequest) {
  if (req.headers.get("x-edit-key") !== process.env.EDIT_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("recipes")
    .select("id,title,caption,ingredients,steps,tags,time_minutes");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const before = new Set((data || []).flatMap((r) => (r.tags as string[]) || []));

  let changed = 0;
  const after = new Set<string>();
  for (const r of data || []) {
    const orig: string[] = r.tags || [];
    const next = classifyRecipeTags(r);
    for (const tag of next) after.add(tag);
    if (JSON.stringify(next) !== JSON.stringify(orig)) {
      const { error: updateError } = await sb.from("recipes").update({ tags: next }).eq("id", r.id);
      if (updateError) {
        return NextResponse.json({ error: updateError.message, changed }, { status: 500 });
      }
      changed++;
    }
  }
  return NextResponse.json({
    ok: true,
    tagsBefore: before.size,
    tagsAfter: after.size,
    recipesChanged: changed,
  });
}
