import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabasePublic } from "@/lib/supabase";
import type { Recipe } from "@/lib/types";
import RecipeView from "./RecipeView";

export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { data } = await supabasePublic()
    .from("recipes")
    .select("title,image_url,ingredients,time_minutes")
    .eq("id", id)
    .single();
  if (!data) return { title: "وصفة — كتاب وصفات أمير" };
  const desc = [
    data.time_minutes ? `⏱ ${data.time_minutes} دقيقة` : null,
    `${(data.ingredients || []).length} مكوّن`,
  ]
    .filter(Boolean)
    .join(" · ");
  const images = data.image_url ? [data.image_url] : [];
  return {
    title: `${data.title} — كتاب وصفات أمير`,
    description: desc,
    openGraph: {
      title: data.title || "وصفة",
      description: desc,
      images,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: data.title || "وصفة",
      description: desc,
      images,
    },
  };
}

export default async function RecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const sb = supabasePublic();
  // Note: `notes` is private (anon can't read it); it's loaded client-side when unlocked.
  const { data, error } = await sb
    .from("recipes")
    .select(
      "id,created_at,source_url,platform,author,title,caption,image_url,ingredients,ingredient_sections,steps,tags,servings,time_minutes,status,favorite,collections,nutrition,rating,cooked,lang"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("تعذّر تحميل الوصفة. حاول مرة أخرى.");
  if (!data) notFound();
  const recipe = { ...(data as Recipe), notes: null };

  let related: Recipe[] = [];
  if (recipe.tags?.length) {
    const { data: rel } = await sb
      .from("recipes")
      .select("id,title,image_url")
      .overlaps("tags", recipe.tags)
      .neq("id", id)
      .limit(6);
    related = (rel as Recipe[]) || [];
  }

  return <RecipeView recipe={recipe} related={related} />;
}
