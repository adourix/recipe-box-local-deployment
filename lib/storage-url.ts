/**
 * Return a browser-reachable public URL for a stored recipe image.
 *
 * SUPABASE_URL may be an internal Docker hostname; never persist that internal
 * hostname into recipes.image_url. Set SUPABASE_PUBLIC_URL to the same gateway
 * origin used by browsers (it can be a LAN IP or a public reverse-proxy URL).
 */
export function recipeImagePublicUrl(path: string): string {
  const base = (
    process.env.SUPABASE_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  if (!base) throw new Error("Missing SUPABASE_PUBLIC_URL");
  const safePath = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/recipe-images/${safePath}`;
}
