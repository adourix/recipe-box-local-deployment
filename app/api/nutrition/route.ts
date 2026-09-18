import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { estimateNutrition } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Backfill: estimate nutrition for recipes that don't have it yet.
export async function POST(req: NextRequest) {
  if (!process.env.EDIT_KEY || req.headers.get("x-edit-key") !== process.env.EDIT_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  // Preview uses the current editor draft and never writes to the database.
  if (body?.draft) {
    const {title, ingredients, servings} = body.draft;
    if (typeof title !== "string" || !Array.isArray(ingredients) || !ingredients.length || ingredients.length > 200 || ingredients.some((i: unknown) => typeof i !== "string" || i.length > 2000)) {
      return NextResponse.json({error: "ingredients required"}, {status: 400});
    }
    try {
      const nutrition = await estimateNutrition(title, ingredients, typeof servings === "string" ? servings : null);
      return nutrition ? NextResponse.json({nutrition}) : NextResponse.json({error: "estimate unavailable"}, {status: 503});
    } catch { return NextResponse.json({error: "estimate unavailable"}, {status: 503}); }
  }
  const force = body?.force === true;
  const sb = supabaseAdmin();

  // Complete the missing values for one recipe without overwriting values that
  // were already saved or manually corrected.
  if (typeof body?.id === "string" && body.id) {
    const { data: recipe, error: readError } = await sb
      .from("recipes")
      .select("id, title, ingredients, servings, nutrition")
      .eq("id", body.id)
      .single();
    if (readError || !recipe) {
      return NextResponse.json({ error: readError?.message || "not found" }, { status: 404 });
    }
    if (!(recipe.ingredients || []).length) {
      return NextResponse.json({ error: "ingredients required" }, { status: 400 });
    }

    const estimate = await estimateNutrition(recipe.title || "", recipe.ingredients, recipe.servings);
    if (!estimate) {
      return NextResponse.json({ error: "nutrition estimate unavailable" }, { status: 503 });
    }
    const current = recipe.nutrition || {};
    const nutrition = {
      calories: current.calories ?? estimate.calories,
      protein_g: current.protein_g ?? estimate.protein_g,
      carbs_g: current.carbs_g ?? estimate.carbs_g,
      fat_g: current.fat_g ?? estimate.fat_g,
    };
    const { data: updated, error: updateError } = await sb
      .from("recipes")
      .update({ nutrition })
      .eq("id", recipe.id)
      .select("nutrition")
      .single();
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, nutrition: updated.nutrition });
  }

  let q = sb
    .from("recipes")
    .select("id, title, ingredients, servings, status")
    .eq("status", "ok")
    .limit(12);
  if (!force) q = q.is("nutrition", null);
  const { data } = await q;

  let updated = 0;
  for (const r of data || []) {
    if (!(r.ingredients || []).length) continue;
    const n = await estimateNutrition(r.title || "", r.ingredients, r.servings);
    if (n) {
      await sb.from("recipes").update({ nutrition: n }).eq("id", r.id);
      updated++;
    }
    await sleep(1500); // stay under the rate limit
  }
  return NextResponse.json({ ok: true, scanned: data?.length || 0, updated });
}
