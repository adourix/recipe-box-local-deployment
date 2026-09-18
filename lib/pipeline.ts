import { randomUUID } from "crypto";
import { supabaseAdmin } from "./supabase";
import {
  extractRecipe,
  extractRecipeFromVideo,
  extractRecipeFromYouTube,
  extractRecipeFromImage,
  estimateNutrition,
} from "./gemini";

/** Use the extracted nutrition, or estimate it from the ingredients if missing. */
async function ensureNutrition(
  extracted: ExtractedRecipe | null,
  title: string,
  ingredients: string[]
) {
  if (extracted?.nutrition) return extracted.nutrition;
  if (!ingredients.length) return null;
  return estimateNutrition(title, ingredients, extracted?.servings ?? null);
}
import type { ExtractedRecipe, IngredientSection } from "./types";
import { normalizeQuantity } from "./scale";
import { arabicNormalize } from "./arabic";
import { canonicalizeRecipeUrl, isDuplicateRecipe, type RecipeIdentity } from "./dedupe";
import { fetchWithTimeout } from "./http";
import { CANONICAL_TAGS, classifyRecipeTags } from "./tags";

/** Search saved recipes by free text (Arabic-normalized token match). */
export async function searchRecipes(
  query: string,
  limit = 6
): Promise<{ id: string; title: string }[]> {
  const tokens = arabicNormalize(query).split(/\s+/).filter((w) => w.length >= 2);
  if (!tokens.length) return [];
  const sb = supabaseAdmin();
  const { data } = await sb.from("recipes").select("id,title,tags,ingredients").limit(500);
  return (data || [])
    .map((r) => {
      const hay = arabicNormalize(
        [r.title, ...(r.tags || []), ...(r.ingredients || [])].filter(Boolean).join(" ")
      );
      let score = 0;
      for (const t of tokens) if (hay.includes(t)) score++;
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => ({ id: x.r.id as string, title: (x.r.title as string) || "وصفة" }));
}

/** Derive a normalized flat ingredient list + (titled) sections from an extract. */
function buildIngredients(extracted: ExtractedRecipe | null): {
  ingredients: string[];
  sections: IngredientSection[];
} {
  const raw = (extracted?.ingredient_sections ?? [])
    .map((s) => ({ title: (s.title || "").trim(), items: (s.items || []).map(normalizeQuantity) }))
    .filter((s) => s.items.length);
  const ingredients = raw.length
    ? raw.flatMap((s) => s.items)
    : (extracted?.ingredients ?? []).map(normalizeQuantity);
  // Only keep sections if there's real grouping (at least one titled section).
  const sections = raw.some((s) => s.title) ? raw : [];
  return { ingredients, sections };
}
import {
  sendMessage,
  escapeHtml,
  getFilePath,
  downloadFile,
} from "./telegram";
import type { PageMeta } from "./types";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Facebook & Instagram return HTTP 400 to a normal browser UA but serve full
// OpenGraph tags (title/description/image) to their own crawler UA. This is the
// key that unlocks reel/post previews server-side.
const CRAWLER_UA =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

/**
 * Facebook's short share links sometimes redirect server-side clients to the
 * login page while preserving the real post URL in the `next` parameter.
 * Recover that URL so the media resolver can work with the stable story link.
 */
export function facebookUrlFromLoginRedirect(redirectUrl: string): string | null {
  try {
    const redirect = new URL(redirectUrl);
    if (!/(^|\.)facebook\.com$/i.test(redirect.hostname)) return null;
    if (!/^\/login\/?$/i.test(redirect.pathname)) return null;
    const next = redirect.searchParams.get("next");
    if (!next) return null;
    const target = new URL(next);
    if (!/(^|\.)facebook\.com$/i.test(target.hostname)) return null;
    target.searchParams.delete("mibextid");
    target.searchParams.delete("rdid");
    target.searchParams.delete("share_url");
    return target.toString();
  } catch {
    return null;
  }
}

async function expandFacebookShareUrl(url: string): Promise<string> {
  if (!/facebook\.com\/share\//i.test(url)) return url;
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { "User-Agent": BROWSER_UA }, redirect: "follow" },
      15_000
    );
    return facebookUrlFromLoginRedirect(res.url) ||
      (/(^|\.)facebook\.com$/i.test(new URL(res.url).hostname) ? res.url : url);
  } catch {
    return url;
  }
}

/** Pull the first http(s) URL out of a message. */
export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/);
  return m ? m[0].replace(/[)\].,]+$/, "") : null;
}

/** Pull all http(s) URLs out of a message (deduped, order preserved). */
export function extractUrls(text: string): string[] {
  const m = text.match(/https?:\/\/[^\s]+/g) || [];
  const cleaned = m.map((u) => u.replace(/[)\].,]+$/, ""));
  return [...new Set(cleaned)];
}

export function detectPlatform(url: string): string {
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/facebook\.com|fb\.watch|fb\.com|m\.facebook/i.test(url)) return "facebook";
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  return "other";
}

/** Trim an overly-long fallback title (FB teaser sentences) to something tidy. */
export function shortenTitle(t?: string | null): string | null {
  if (!t) return t ?? null;
  let s = t.split(/[|｜\n]/)[0].trim();
  if (s.length > 60) {
    s = s.slice(0, 60);
    const sp = s.lastIndexOf(" ");
    if (sp > 30) s = s.slice(0, sp);
    s = s.trim() + "…";
  }
  return s;
}

// Platforms whose recipe may live only in the video — worth transcribing.
const VIDEO_PLATFORMS = new Set(["instagram", "facebook", "tiktok", "youtube"]);
const VIDEO_MAX = 35 * 1024 * 1024;
const AUDIO_MAX = 20 * 1024 * 1024;
// Above this duration, transcribe the (tiny) audio track instead of the video —
// long videos are hundreds of MB and won't fit the function's time/size budget.
const LONG_VIDEO_SECONDS = 180;

interface Resolved {
  video_url?: string;
  audio_url?: string;
  video_filesize?: number;
  duration?: number;
  title?: string;
  uploader?: string;
}

/** Alert the owner (once per 6h) that Instagram cookies likely expired. */
async function maybeAlertIgCookies(): Promise<void> {
  const chat = process.env.ALLOWED_TELEGRAM_USER_ID;
  if (!chat) return;
  try {
    const sb = supabaseAdmin();
    const { data } = await sb.from("app_kv").select("ts").eq("key", "ig_cookie_alert").maybeSingle();
    const last = data?.ts ? new Date(data.ts).getTime() : 0;
    if (Date.now() - last < 6 * 3600 * 1000) return;
    await sb.from("app_kv").upsert({ key: "ig_cookie_alert", ts: new Date().toISOString() });
    await sendMessage(
      Number(chat),
      "⚠️ يبدو أن كوكيز انستغرام انتهت صلاحيتها — روابط انستغرام لن تُستخرج بالكامل حتى تحدّثها.\nصدّر الكوكيز من جديد (إضافة Cookie-Editor) وأرسلها لتحديثها."
    );
  } catch {
    /* best effort */
  }
}

/**
 * Ask the resolver microservice to turn a page URL into direct media URLs.
 * yt-dlp fails to parse Facebook pages maybe a third of the time (FB serves
 * varying markup), and it fails fast — so just try again before giving up.
 */
export async function resolveVideoUrl(pageUrl: string, tries = 3): Promise<Resolved | null> {
  for (let i = 0; i < tries; i++) {
    const r = await resolveOnce(pageUrl);
    if (r) return r;
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 1500));
  }
  if (/instagram\.com/i.test(pageUrl)) await maybeAlertIgCookies();
  return null;
}

async function resolveOnce(pageUrl: string): Promise<Resolved | null> {
  const endpoint = process.env.RESOLVER_URL;
  if (!endpoint) return null;
  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": process.env.RESOLVER_SECRET || "",
      },
      body: JSON.stringify({ url: pageUrl }),
    }, 25_000);
    const j = await res.json().catch(() => null);
    if (!res.ok || (!j?.video_url && !j?.audio_url)) {
      // IG failing to resolve almost always means the cookies expired — the
      // caller alerts once all retries are spent.
      if (j?.error) console.error("resolver error", j.error);
      return null;
    }
    return j;
  } catch (e) {
    console.error("resolveVideoUrl failed", e);
    return null;
  }
}

/** Read a response body, aborting once it exceeds maxBytes (streams, so a
 * missing/incorrect Content-Length can't blow up memory). */
async function readLimited(res: Response, maxBytes: number): Promise<Buffer | null> {
  const len = Number(res.headers.get("content-length") || 0);
  if (len && len > maxBytes) return null;
  const body = res.body;
  if (!body) {
    const b = Buffer.from(await res.arrayBuffer());
    return b.length > maxBytes ? null : b;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

/** Download a resolved media URL, aborting if it exceeds maxBytes. */
async function fetchMedia(url: string, maxBytes: number): Promise<Buffer | null> {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": BROWSER_UA } }, 30_000);
    if (!res.ok) return null;
    return await readLimited(res, maxBytes);
  } catch (e) {
    console.error("fetchMedia failed", e);
    return null;
  }
}

/**
 * Fetch a recipe from a resolved reel/video: use the video for short clips
 * (captures on-screen text), fall back to the audio track for long ones.
 */
async function transcribeFromResolved(
  resolved: Resolved | null,
  knownTags?: string[]
): Promise<ExtractedRecipe | null> {
  if (!resolved) return null;

  const isLong =
    (resolved.duration ?? 0) > LONG_VIDEO_SECONDS ||
    (resolved.video_filesize ?? 0) > VIDEO_MAX;

  let media: Buffer | null = null;
  let mime = "video/mp4";

  if (!isLong && resolved.video_url) {
    media = await fetchMedia(resolved.video_url, VIDEO_MAX);
  }
  if (!media && resolved.audio_url) {
    media = await fetchMedia(resolved.audio_url, AUDIO_MAX);
    if (media) mime = "audio/mp4";
  }
  if (!media && resolved.video_url) {
    media = await fetchMedia(resolved.video_url, VIDEO_MAX);
  }
  if (!media) return null;
  return extractRecipeFromVideo(media, mime, knownTags);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

/** Parse all <meta> tags regardless of attribute order. */
function parseMetaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    const val = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (key && val != null) out[key.toLowerCase()] = decodeEntities(val);
  }
  return out;
}

function metaFromHtml(html: string): PageMeta {
  const meta = parseMetaTags(html);
  return {
    image: meta["og:image"] || meta["twitter:image"],
    caption:
      meta["og:description"] || meta["description"] || meta["twitter:description"],
    title: meta["og:title"] || meta["twitter:title"],
    author: meta["og:site_name"] || meta["author"],
  };
}

function hasContent(m: PageMeta): boolean {
  return Boolean(m.image || m.title || m.caption);
}

async function fetchWith(url: string, ua: string): Promise<PageMeta> {
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": ua, "Accept-Language": "ar,en;q=0.9" },
    redirect: "follow",
  }, 15_000);
  if (!res.ok) return {};
  return metaFromHtml(await res.text());
}

/** YouTube channel name (+ title/thumbnail) via the public oEmbed endpoint. */
async function youtubeOEmbed(
  url: string
): Promise<{ author?: string; title?: string; thumbnail?: string } | null> {
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
      { headers: { "User-Agent": BROWSER_UA } },
      10_000
    );
    if (!res.ok) return null;
    const j = await res.json();
    return { author: j.author_name, title: j.title, thumbnail: j.thumbnail_url };
  } catch {
    return null;
  }
}

/**
 * Best-effort OpenGraph fetch. Tries the FB/IG crawler UA first (required for
 * their reels), then falls back to a browser UA for sites that prefer it.
 * Never throws.
 */
export async function fetchMeta(url: string): Promise<PageMeta> {
  try {
    const primary = await fetchWith(url, CRAWLER_UA);
    if (hasContent(primary)) return primary;
    const fallback = await fetchWith(url, BROWSER_UA);
    return hasContent(fallback) ? fallback : primary;
  } catch (e) {
    console.error("fetchMeta failed", e);
    return {};
  }
}

/**
 * FB/IG set og:title to "<views> · <reactions> | <caption line> | <author>".
 * Strip the stats segment and pull the author out so titles read cleanly.
 */
export function cleanSocialTitle(raw?: string): { title?: string; author?: string } {
  if (!raw) return {};
  // Instagram/Facebook: "<name> على/on Instagram: "caption"" → author + caption.
  const ig = raw
    .replace(/[‎‏]/g, "")
    .match(/^(.*?)\s+(?:على|on)\s+(?:Instagram|Facebook)\b[^:]*:\s*["“]?(.*?)["”]?\.?\s*$/s);
  if (ig) {
    return {
      author: ig[1].trim() || undefined,
      title: ig[2].trim() || undefined,
    };
  }
  const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
  const isStats = (s: string) =>
    /(مشاهدة|تفاعل|إعجاب|تعليق|مشاركة|views?|reactions?|likes?|comments?|shares?)/i.test(s) &&
    /(\d|ألف|k|m|مليون|thousand|million)/i.test(s);
  const kept = parts.filter((p) => !isStats(p));
  let author: string | undefined;
  if (kept.length > 1) author = kept.pop();
  const title = kept.join(" — ").trim() || undefined;
  return { title, author };
}

/** Upload raw image bytes to Supabase Storage. Returns public URL or null. */
async function uploadImageBuffer(
  sb: ReturnType<typeof supabaseAdmin>,
  id: string,
  buf: Buffer,
  ct: string
): Promise<string | null> {
  try {
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
    const path = `${id}.${ext}`;
    const { error } = await sb.storage
      .from("recipe-images")
      .upload(path, buf, { contentType: ct, upsert: true });
    if (error) {
      console.error("storage upload failed", error);
      return null;
    }
    return sb.storage.from("recipe-images").getPublicUrl(path).data.publicUrl;
  } catch (e) {
    console.error("uploadImageBuffer failed", e);
    return null;
  }
}

/** Remove every supported cover extension for an abandoned insert. Uploads use
 * a recipe id as the basename, so cleanup is deterministic and best-effort. */
async function removeRecipeImage(
  sb: ReturnType<typeof supabaseAdmin>,
  id: string
): Promise<void> {
  const paths = ["jpg", "png", "webp"].map((ext) => `${id}.${ext}`);
  const { error } = await sb.storage.from("recipe-images").remove(paths);
  if (error) console.error("duplicate image cleanup failed", error);
}

/** Download the cover image from a URL and store it. Returns public URL or null. */
async function persistImage(
  sb: ReturnType<typeof supabaseAdmin>,
  id: string,
  imageUrl?: string
): Promise<string | null> {
  if (!imageUrl) return null;
  try {
    const res = await fetchWithTimeout(imageUrl, { headers: { "User-Agent": BROWSER_UA } }, 15_000);
    if (!res.ok) return null;
    const buf = await readLimited(res, 10 * 1024 * 1024);
    if (!buf) return null;
    return uploadImageBuffer(sb, id, buf, res.headers.get("content-type") || "image/jpeg");
  } catch (e) {
    console.error("persistImage failed", e);
    return null;
  }
}

/** Most-used existing tags, so the model reuses them instead of inventing synonyms. */
async function getKnownTags(sb: ReturnType<typeof supabaseAdmin>): Promise<string[]> {
  const { data } = await sb.from("recipes").select("tags").limit(500);
  const count = new Map<string, number>();
  for (const r of data || []) for (const t of (r.tags as string[]) || []) count.set(t, (count.get(t) || 0) + 1);
  return [
    ...CANONICAL_TAGS,
    ...[...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([t]) => t),
  ].filter((tag, index, all) => all.indexOf(tag) === index);
}

type StoredRecipeIdentity = RecipeIdentity & {
  id: string;
  status: SaveResult["status"];
};

/** Find an already-complete recipe with the same canonical source or strongly
 * matching title + content. The conservative content threshold lives in the
 * pure dedupe module so it can be regression-tested without a database. */
async function findDuplicateRecipe(
  sb: ReturnType<typeof supabaseAdmin>,
  candidate: RecipeIdentity,
  excludeId?: string
): Promise<StoredRecipeIdentity | null> {
  const { data, error } = await sb
    .from("recipes")
    .select("id,status,source_url,author,title,ingredients,steps")
    .eq("status", "ok")
    .limit(1000);
  if (error) {
    console.error("duplicate lookup failed", error);
    return null;
  }
  return (
    ((data || []) as StoredRecipeIdentity[]).find(
      (recipe) => recipe.id !== excludeId && isDuplicateRecipe(candidate, recipe)
    ) || null
  );
}

export interface SaveResult {
  id: string;
  status: "ok" | "needs_review" | "fetch_failed";
  title: string;
  viaVideo: boolean;
  updated: boolean;
  duplicate: boolean;
}

/**
 * Core save pipeline shared by Telegram, the web share target, and retry.
 * Dedupes by source_url: an already-complete recipe is returned untouched;
 * an incomplete one (needs_review/fetch_failed) is re-processed in place.
 */
export async function saveFromUrl(url: string): Promise<SaveResult> {
  const sb = supabaseAdmin();
  const expandedUrl = await expandFacebookShareUrl(url);
  const platform = detectPlatform(expandedUrl);
  const originalSourceUrl = canonicalizeRecipeUrl(url);
  const sourceUrl = canonicalizeRecipeUrl(expandedUrl);

  const { data: existingRows } = await sb
    .from("recipes")
    .select("id, image_url, status, title, ingredients, steps")
    .in("source_url", [...new Set([url, originalSourceUrl, expandedUrl, sourceUrl])])
    .limit(1);
  const existing = existingRows?.[0] || null;

  // Already have a good version — don't clobber it (protects manual edits).
  if (
    existing &&
    existing.status === "ok" &&
    ((existing.ingredients?.length ?? 0) > 0 || (existing.steps?.length ?? 0) > 0)
  ) {
    return {
      id: existing.id,
      status: "ok",
      title: existing.title || "وصفة",
      viaVideo: false,
      updated: false,
      duplicate: true,
    };
  }

  const id = existing?.id || randomUUID();

  const meta = await fetchMeta(expandedUrl);
  const cleaned = cleanSocialTitle(meta.title);
  if (cleaned.title) meta.title = cleaned.title;
  // Prefer the parsed account/page name over generic og:site_name ("Instagram").
  if (cleaned.author) meta.author = cleaned.author;

  // YouTube: yt-dlp is bot-blocked from datacenter IPs, so get the channel name
  // (and a clean title/thumbnail) from the public oEmbed endpoint instead.
  let ytAuthor: string | null = null;
  if (platform === "youtube") {
    const oe = await youtubeOEmbed(expandedUrl);
    if (oe?.author) ytAuthor = oe.author;
    if (oe?.title) meta.title = oe.title;
    if (!meta.image && oe?.thumbnail) meta.image = oe.thumbnail;
  }

  // Optimization: reel captions are usually teasers. Only spend a Gemini call on
  // the caption for non-video platforms or genuinely long captions; otherwise go
  // straight to the video/audio (saves a call = faster + avoids quota limits).
  const knownTags = await getKnownTags(sb);
  const richCaption = (meta.caption || "").length >= 250;
  const doCaption = !VIDEO_PLATFORMS.has(platform) || richCaption;
  const [captionExtract, freshImage] = await Promise.all([
    doCaption ? extractRecipe({ title: meta.title, caption: meta.caption }, knownTags) : Promise.resolve(null),
    persistImage(sb, id, meta.image),
  ]);
  let extracted: ExtractedRecipe | null = captionExtract;
  const image_url = freshImage || existing?.image_url || null;

  const captionHasRecipe =
    extracted?.is_recipe &&
    ((extracted.ingredients?.length ?? 0) > 0 || (extracted.steps?.length ?? 0) > 0);

  // Resolve once for non-YouTube video platforms — gives the real uploader
  // (IG/TikTok/FB account) for the chef, and the media URLs for transcription.
  // (YouTube uses oEmbed above + Gemini-native extraction, so skip the resolver.)
  let resolved: Resolved | null = null;
  if (VIDEO_PLATFORMS.has(platform) && platform !== "youtube") {
    resolved = await resolveVideoUrl(expandedUrl);
  }

  let viaVideo = false;
  if (!captionHasRecipe && VIDEO_PLATFORMS.has(platform)) {
    let fromVideo: ExtractedRecipe | null = null;
    if (platform === "youtube") {
      fromVideo = await extractRecipeFromYouTube(expandedUrl, knownTags);
    } else {
      fromVideo = await transcribeFromResolved(resolved, knownTags);
    }
    if (
      fromVideo?.is_recipe &&
      ((fromVideo.ingredients?.length ?? 0) > 0 || (fromVideo.steps?.length ?? 0) > 0)
    ) {
      extracted = fromVideo;
      viaVideo = true;
    }
  }

  // Prefer the real uploader (IG/TikTok/FB account or YouTube channel) as the chef.
  const author = resolved?.uploader || ytAuthor || meta.author || null;

  const { ingredients, sections } = buildIngredients(extracted);
  const steps = extracted?.steps ?? [];
  const title =
    (extracted?.is_recipe && extracted.title) || shortenTitle(meta.title) || "وصفة بدون عنوان";

  let status: SaveResult["status"] = "ok";
  if (!meta.image && !meta.caption && !meta.title) status = "fetch_failed";
  else if (!extracted?.is_recipe || (ingredients.length === 0 && steps.length === 0))
    status = "needs_review";

  if (!existing) {
    const duplicate = await findDuplicateRecipe(sb, {
      source_url: sourceUrl,
      author,
      title,
      ingredients,
      steps,
    });
    if (duplicate) {
      await removeRecipeImage(sb, id);
      return {
        id: duplicate.id,
        status: duplicate.status,
        title: duplicate.title || title,
        viaVideo: false,
        updated: false,
        duplicate: true,
      };
    }
  }

  const row = {
    source_url: sourceUrl,
    platform,
    author,
    title,
    caption: meta.caption ?? null,
    image_url,
    ingredients,
    ingredient_sections: sections.length ? sections : null,
    steps,
    tags: classifyRecipeTags({
      title,
      caption: meta.caption,
      ingredients,
      steps,
      tags: extracted?.tags ?? [],
      time_minutes: extracted?.time_minutes,
    }),
    servings: extracted?.servings ?? null,
    time_minutes: extracted?.time_minutes ?? null,
    nutrition: await ensureNutrition(extracted, title, ingredients),
    status,
    raw: { ...meta, via_video: viaVideo },
    lang: "ar",
  };

  const { error } = existing
    ? await sb.from("recipes").update(row).eq("id", id)
    : await sb.from("recipes").insert({ id, ...row });
  if (error) {
    console.error("saveFromUrl db error", error);
    throw new Error(error.message);
  }

  return { id, status, title, viaVideo, updated: Boolean(existing), duplicate: false };
}

/** Send the appropriate Arabic reply for a save result. */
export async function sendSaveResult(chatId: number, r: SaveResult): Promise<void> {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const link = base ? `\n${base}/recipe/${r.id}` : "";

  if (r.duplicate) {
    await sendMessage(
      chatId,
      `ℹ️ هذه الوصفة محفوظة عندك مسبقًا: <b>${escapeHtml(r.title)}</b>${link}`
    );
  } else if (r.status === "ok") {
    const tag = r.viaVideo ? " 🎬 (من الفيديو)" : "";
    const verb = r.updated ? "تم تحديث" : "تم حفظ";
    await sendMessage(chatId, `✅ ${verb} الوصفة: <b>${escapeHtml(r.title)}</b>${tag}${link}`);
  } else if (r.status === "needs_review") {
    await sendMessage(
      chatId,
      `⚠️ حفظت الرابط والصورة، لكن لم أتمكن من قراءة الوصفة بوضوح. أضفتها لقائمة المراجعة.${link}`
    );
  } else {
    await sendMessage(
      chatId,
      `⚠️ لم أستطع جلب محتوى الرابط (قد يكون خاصًا). حفظت الرابط فقط.${link}`
    );
  }
}

/**
 * Core: extract a recipe from an image buffer (screenshot / handwritten /
 * cookbook page) and save it. Shared by Telegram photos and the web uploader.
 */
export async function saveFromImage(
  buf: Buffer,
  mimeType: string,
  opts?: { caption?: string }
): Promise<SaveResult> {
  const sb = supabaseAdmin();
  const id = randomUUID();

  const knownTags = await getKnownTags(sb);
  const [extracted, image_url] = await Promise.all([
    extractRecipeFromImage(buf, mimeType, knownTags, opts?.caption),
    uploadImageBuffer(sb, id, buf, mimeType),
  ]);

  const { ingredients, sections } = buildIngredients(extracted);
  const steps = extracted?.steps ?? [];
  const title = (extracted?.is_recipe && extracted.title) || "وصفة من صورة";
  const captionUrl = opts?.caption ? extractUrl(opts.caption) : null;
  const status: SaveResult["status"] =
    !extracted?.is_recipe || (ingredients.length === 0 && steps.length === 0)
      ? "needs_review"
      : "ok";

  const duplicate = await findDuplicateRecipe(sb, {
    source_url: captionUrl ? canonicalizeRecipeUrl(captionUrl) : null,
    author: null,
    title,
    ingredients,
    steps,
  });
  if (duplicate) {
    await removeRecipeImage(sb, id);
    return {
      id: duplicate.id,
      status: duplicate.status,
      title: duplicate.title || title,
      viaVideo: false,
      updated: false,
      duplicate: true,
    };
  }

  const { error } = await sb.from("recipes").insert({
    id,
    source_url: captionUrl ? canonicalizeRecipeUrl(captionUrl) : "photo-upload",
    platform: captionUrl ? detectPlatform(captionUrl) : "photo",
    author: null,
    title,
    caption: opts?.caption ?? null,
    image_url,
    ingredients,
    ingredient_sections: sections.length ? sections : null,
    steps,
    tags: extracted?.tags ?? [],
    servings: extracted?.servings ?? null,
    time_minutes: extracted?.time_minutes ?? null,
    nutrition: await ensureNutrition(extracted, title, ingredients),
    status,
    raw: { via: "photo" },
    lang: "ar",
  });
  if (error) throw new Error(error.message);

  return { id, status, title, viaVideo: false, updated: false, duplicate: false };
}

/** Telegram entry point for a photo/screenshot sent to the bot. */
export async function processPhoto(opts: {
  fileId: string;
  chatId: number;
  caption?: string;
}): Promise<void> {
  const { path } = await getFilePath(opts.fileId);
  if (!path) {
    await sendMessage(opts.chatId, "⚠️ تعذّر الوصول إلى الصورة.");
    return;
  }
  const buf = await downloadFile(path);
  let r: SaveResult;
  try {
    r = await saveFromImage(buf, "image/jpeg", { caption: opts.caption });
  } catch {
    await sendMessage(opts.chatId, "⚠️ حدث خطأ أثناء قراءة الصورة.");
    return;
  }
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const link = base ? `\n${base}/recipe/${r.id}` : "";
  if (r.duplicate) {
    await sendMessage(opts.chatId, `ℹ️ هذه الوصفة محفوظة عندك مسبقًا: <b>${escapeHtml(r.title)}</b>${link}`);
  } else if (r.status === "ok") {
    await sendMessage(opts.chatId, `✅ استخرجت الوصفة من الصورة: <b>${escapeHtml(r.title)}</b>${link}`);
  } else {
    await sendMessage(
      opts.chatId,
      `⚠️ حفظت الصورة لكن لم أتمكن من قراءة وصفة واضحة منها.${link}`
    );
  }
}

const TG_DOWNLOAD_MAX = 20 * 1024 * 1024; // Telegram bot API download limit

/**
 * Pipeline for a video sent directly to the bot: download from Telegram ->
 * Gemini transcribes speech + on-screen text -> extract recipe -> insert ->
 * reply. Used for reels whose recipe is only spoken (not in the caption).
 */
export async function processVideo(opts: {
  fileId: string;
  thumbFileId?: string;
  mimeType?: string;
  chatId: number;
  caption?: string;
  sizeHint?: number;
}): Promise<void> {
  const sb = supabaseAdmin();
  const id = randomUUID();

  const { path, size } = await getFilePath(opts.fileId);
  if (!path) {
    await sendMessage(opts.chatId, "⚠️ تعذّر الوصول إلى الفيديو من تيليجرام.");
    return;
  }
  if ((size || opts.sizeHint || 0) > TG_DOWNLOAD_MAX) {
    await sendMessage(
      opts.chatId,
      "⚠️ حجم الفيديو أكبر من 20 ميجابايت (حد بوت تيليجرام للتنزيل). أرسل مقطعًا أقصر أو بجودة أقل."
    );
    return;
  }

  const buf = await downloadFile(path);
  const mimeType = opts.mimeType || "video/mp4";

  const knownTags = await getKnownTags(sb);
  const [extracted, image_url] = await Promise.all([
    extractRecipeFromVideo(buf, mimeType, knownTags),
    (async () => {
      if (!opts.thumbFileId) return null;
      const t = await getFilePath(opts.thumbFileId);
      if (!t.path) return null;
      return uploadImageBuffer(sb, id, await downloadFile(t.path), "image/jpeg");
    })(),
  ]);

  const { ingredients, sections } = buildIngredients(extracted);
  const steps = extracted?.steps ?? [];
  const title = (extracted?.is_recipe && extracted.title) || "وصفة من فيديو";
  const captionUrl = opts.caption ? extractUrl(opts.caption) : null;

  const status: "ok" | "needs_review" =
    !extracted?.is_recipe || (ingredients.length === 0 && steps.length === 0)
      ? "needs_review"
      : "ok";

  const duplicate = await findDuplicateRecipe(sb, {
    source_url: captionUrl ? canonicalizeRecipeUrl(captionUrl) : null,
    author: null,
    title,
    ingredients,
    steps,
  });
  if (duplicate) {
    await removeRecipeImage(sb, id);
    const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
    const link = base ? `\n${base}/recipe/${duplicate.id}` : "";
    await sendMessage(
      opts.chatId,
      `ℹ️ هذه الوصفة محفوظة عندك مسبقًا: <b>${escapeHtml(duplicate.title || title)}</b>${link}`
    );
    return;
  }

  const { error } = await sb.from("recipes").insert({
    id,
    source_url: captionUrl ? canonicalizeRecipeUrl(captionUrl) : "video-upload",
    platform: captionUrl ? detectPlatform(captionUrl) : "video",
    author: null,
    title,
    caption: opts.caption ?? null,
    image_url,
    ingredients,
    ingredient_sections: sections.length ? sections : null,
    steps,
    tags: extracted?.tags ?? [],
    servings: extracted?.servings ?? null,
    time_minutes: extracted?.time_minutes ?? null,
    nutrition: await ensureNutrition(extracted, title, ingredients),
    status,
    raw: { via: "telegram_video" },
    lang: "ar",
  });

  if (error) {
    console.error("insert failed", error);
    await sendMessage(opts.chatId, "⚠️ حدث خطأ أثناء الحفظ في قاعدة البيانات.");
    return;
  }

  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const link = base ? `\n${base}/recipe/${id}` : "";
  if (status === "ok") {
    await sendMessage(
      opts.chatId,
      `✅ تم استخراج الوصفة من الفيديو: <b>${escapeHtml(title)}</b>${link}`
    );
  } else {
    await sendMessage(
      opts.chatId,
      `⚠️ حفظت الفيديو لكن لم أتمكن من استخراج وصفة واضحة منه.${link}`
    );
  }
}
