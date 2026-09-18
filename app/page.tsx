import { supabasePublic } from "@/lib/supabase";
import type { Recipe } from "@/lib/types";
import GalleryClient from "./GalleryClient";

export const revalidate = 0; // always fresh — new recipes show immediately

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tag?: string; collection?: string }>;
}) {
  const { q = "", tag = "", collection = "" } = await searchParams;

  const sb = supabasePublic();
  const data: Recipe[] = [];
  // Supabase paginates reads. Fetch every batch so client filters cover the whole book.
  const batchSize = 500;
  for (let offset = 0; ; offset += batchSize) {
    const {data: batch, error} = await sb.from("recipes")
      .select("id,created_at,source_url,platform,author,title,image_url,ingredients,tags,servings,time_minutes,status,favorite,collections,rating,cooked")
      .order("created_at", {ascending: false}).order("id", {ascending: false}).range(offset, offset + batchSize - 1);
    if (error) throw new Error("تعذّر تحميل كتاب الوصفات. حاول مرة أخرى.");
    data.push(...(batch as Recipe[]));
    if (batch.length < batchSize) break;
  }

  return (
    <GalleryClient
      recipes={(data as Recipe[]) || []}
      initialQuery={q}
      initialTag={tag}
      initialCollection={collection}
    />
  );
}
