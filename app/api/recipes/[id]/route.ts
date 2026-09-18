import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sectionizeIngredients } from "@/lib/gemini";
import { normalizeQuantity } from "@/lib/scale";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const key = process.env.EDIT_KEY;
  if (!key) return false; // editing disabled unless a key is configured
  return req.headers.get("x-edit-key") === key;
}

const EDITABLE = new Set([
  "title",
  "author",
  "servings",
  "time_minutes",
  "ingredients",
  "steps",
  "tags",
  "status",
  "image_url",
  "favorite",
  "collections",
  "nutrition",
  "notes",
  "rating",
  "cooked",
]);

// Returns private fields (notes) — only for the owner (edit key).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const { data, error } = await supabaseAdmin()
    .from("recipes")
    .select("notes")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ notes: data?.notes ?? null });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const form = req.headers.get("content-type")?.includes("multipart/form-data") ? await req.formData().catch(() => null) : null;
  const body = form ? (() => { try { return JSON.parse(String(form.get("data") || "{}")); } catch { return null; } })() : await req.json().catch(() => null);
  const image = form?.get("image");
  if (image instanceof File && (!image.size || image.size > 10 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(image.type))) {
    return NextResponse.json({error: "invalid image"}, {status: 415});
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!EDITABLE.has(k)) continue;
    if (k === "time_minutes") {
      const n = Number(v);
      update[k] = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    } else if (k === "favorite" || k === "cooked") {
      update[k] = Boolean(v);
    } else if (k === "rating") {
      const n = Number(v);
      update[k] = Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n) : null;
    } else if (k === "nutrition") {
      if (v == null) {
        update[k] = null;
        continue;
      }
      if (typeof v !== "object" || Array.isArray(v)) {
        return NextResponse.json({ error: "invalid nutrition" }, { status: 400 });
      }
      const source = v as Record<string, unknown>;
      const nutrition: Record<string, number | null> = {};
      for (const field of ["calories", "protein_g", "carbs_g", "fat_g"]) {
        const raw = source[field];
        if (raw == null || raw === "") {
          nutrition[field] = null;
          continue;
        }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 100_000) {
          return NextResponse.json({ error: `invalid nutrition.${field}` }, { status: 400 });
        }
        nutrition[field] = field === "calories" ? Math.round(n) : Math.round(n * 10) / 10;
      }
      update[k] = Object.values(nutrition).every((value) => value == null) ? null : nutrition;
    } else if (
      k === "ingredients" ||
      k === "steps" ||
      k === "tags" ||
      k === "collections"
    ) {
      update[k] = Array.isArray(v)
        ? v.map((x) => String(x).trim()).filter(Boolean)
        : [];
    } else {
      update[k] = v === "" ? null : v;
    }
  }
  if (Object.keys(update).length === 0 && !(image instanceof File)) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  if (update.status === "ok" || "ingredients" in update || "steps" in update || "title" in update) {
    const {data: current, error} = await sb.from("recipes").select("title,ingredients,steps,status").eq("id", id).single();
    if (error || !current) return NextResponse.json({error: "not found"}, {status: 404});
    const candidate = {...current, ...update};
    if (candidate.status === "ok" && (!String(candidate.title || "").trim() || !Array.isArray(candidate.ingredients) || !candidate.ingredients.length || !Array.isArray(candidate.steps) || !candidate.steps.length)) {
      return NextResponse.json({error: "title, ingredients and steps required"}, {status: 400});
    }
  }

  // Editing the ingredients: normalize quantities and RE-SLICE into sections so
  // the recipe keeps its grouping with the new values (multi-part recipes).
  if ("ingredients" in update) {
    const ings = (update.ingredients as string[]).map(normalizeQuantity);
    let title = typeof update.title === "string" ? update.title : "";
    if (!title) {
      const { data: cur } = await sb.from("recipes").select("title").eq("id", id).single();
      title = cur?.title || "";
    }
    const secs = (await sectionizeIngredients(title, ings))
      .map((s) => ({ title: s.title, items: s.items.map(normalizeQuantity) }))
      .filter((s) => s.title && s.items.length);
    if (secs.length >= 2 && secs.flatMap((s) => s.items).length >= ings.length) {
      update.ingredient_sections = secs;
      update.ingredients = secs.flatMap((s) => s.items);
    } else {
      update.ingredient_sections = null;
      update.ingredients = ings;
    }
  }
  let uploadedPath: string | null = null;
  if (image instanceof File) {
    const ext = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
    uploadedPath = `${id}-${crypto.randomUUID()}.${ext}`;
    const {error} = await sb.storage.from("recipe-images").upload(uploadedPath, Buffer.from(await image.arrayBuffer()), {contentType: image.type});
    if (error) return NextResponse.json({error: "image upload failed"}, {status: 500});
    update.image_url = sb.storage.from("recipe-images").getPublicUrl(uploadedPath).data.publicUrl;
  }
  const { data, error } = await sb
    .from("recipes")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    if (uploadedPath) await sb.storage.from("recipe-images").remove([uploadedPath]);
    console.error("update failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, recipe: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const sb = supabaseAdmin();

  // Remove the stored cover image (best effort) before deleting the row.
  const { data: row } = await sb
    .from("recipes")
    .select("image_url")
    .eq("id", id)
    .single();
  const marker = "/recipe-images/";
  if (row?.image_url?.includes(marker)) {
    const path = row.image_url.split(marker)[1];
    if (path) await sb.storage.from("recipe-images").remove([path]);
  }

  const { error } = await sb.from("recipes").delete().eq("id", id);
  if (error) {
    console.error("delete failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
