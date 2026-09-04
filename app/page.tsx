import { supabasePublic } from "@/lib/supabase";
import type { Recipe } from "@/lib/types";
import GalleryClient from "./GalleryClient";
import { autoRetryLatestFailure } from "@/lib/queue";
import { classifyRecipeTags } from "@/lib/tags";

export const revalidate = 0; // always fresh — new recipes show immediately

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string; collection?: string }>;
}) {
  const { q = "", tag = "", collection = "" } = await searchParams;

  // Do not make users wait for the nightly sweep after a transient import
  // failure. The helper is idempotent and queues at most one retry per recipe.
  await autoRetryLatestFailure().catch(() => {});

  const sb = supabasePublic();
  // Only the columns the gallery needs — skip heavy steps/raw/caption for speed.
  const { data } = await sb
    .from("recipes")
    .select(
      "id,created_at,source_url,platform,author,title,image_url,ingredients,tags,servings,time_minutes,status,favorite,collections,rating,cooked"
    )
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <GalleryClient
      recipes={((data as Recipe[]) || []).map((recipe) => ({
        ...recipe,
        tags: classifyRecipeTags(recipe),
      }))}
      initialQuery={q}
      initialTag={tag}
      initialCollection={collection}
    />
  );
}
