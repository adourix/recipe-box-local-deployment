import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
// The installed sharp package exposes broken ESM type exports; use its Node entrypoint for this fixture tool.
import { createRequire } from "node:module";
const sharp = createRequire(import.meta.url)("sharp");
import { supabaseAdmin } from "../lib/supabase";

async function main() {
  loadEnvConfig(process.cwd());
  const base = process.env.UX_TEST_URL || "http://127.0.0.1:3002";
  const sb = supabaseAdmin();
  const run = randomUUID();
  const filename = `ux-verification-${run}.html`;
  const file = path.join(process.cwd(), "public", filename);
  const sources = [`${base}/${filename}`, `https://example.com/recipebox-ux-verification/photo/${run}`];
  const checks: string[] = [];
  const imagePaths: string[] = [];
  const key = process.env.EDIT_KEY!;
  const caption = `UI verification ${run}. A complete yogurt oat bowl recipe. Ingredients: 83 grams plain yogurt, 17 grams oat bran, 11 grams sesame seeds. Steps: 1. Put yogurt into a bowl. 2. Stir in oat bran. 3. Sprinkle sesame seeds and serve. Makes 1 serving, takes 3 minutes.`;
  await writeFile(file, `<!doctype html><html><head><title>UI verification ${run}</title><meta property="og:title" content="UI verification ${run}"><meta property="og:description" content="${caption}"></head><body><h1>UI verification</h1><p>${caption}</p></body></html>`);
  try {
    const web = await fetch(`${base}/api/web-save`, {method:"POST", headers:{"x-edit-key":key,"content-type":"application/json"}, body:JSON.stringify({url:sources[0]}), signal:AbortSignal.timeout(310000)});
    assert.equal(web.status,200,"Controlled URL import failed");
    const webResult = await web.json(); assert.equal(webResult.status,"ok","URL extraction incomplete"); checks.push("real URL extraction and save");
    const duplicate = await fetch(`${base}/api/web-save`, {method:"POST",headers:{"x-edit-key":key,"content-type":"application/json"},body:JSON.stringify({url:sources[0]})});
    assert.equal(duplicate.status,409); assert.equal((await duplicate.json()).id,webResult.id); checks.push("real duplicate link returns original");
    const lines = ["UI verification - Yogurt oat bowl", "Ingredients", "83 grams plain yogurt", "17 grams oat bran", "11 grams sesame seeds", "Steps", "1. Put yogurt into a bowl.", "2. Stir in oat bran.", "3. Add sesame seeds and serve.", "1 serving. 3 minutes."];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650"><rect width="100%" height="100%" fill="white"/>${lines.map((line,i)=>`<text x="40" y="${55+i*55}" font-family="sans-serif" font-size="30" fill="black">${line}</text>`).join("")}</svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const form = new FormData(); form.append("file", new Blob([new Uint8Array(png)],{type:"image/png"}),"verification.png"); form.append("caption",sources[1]);
    const photo = await fetch(`${base}/api/photo-save`, {method:"POST",headers:{"x-edit-key":key},body:form,signal:AbortSignal.timeout(310000)});
    assert.equal(photo.status,200,"Photo import failed"); const photoResult = await photo.json(); assert.equal(photoResult.status,"ok","Photo extraction incomplete"); checks.push("real image extraction and save");
    const {data: rows, error} = await sb.from("recipes").select("id,source_url,ingredients,steps,image_url").in("source_url",sources);
    assert.equal(error,null); assert.equal(rows?.length,2);
    for (const row of rows || []) { assert.ok(row.ingredients.length); assert.ok(row.steps.length); if(row.image_url?.includes("/recipe-images/")) imagePaths.push(row.image_url.split("/recipe-images/")[1]); }
    checks.push("both imported records contain ingredients and steps");
  } finally {
    // Limit cleanup to the two unique source URLs owned by this test run.
    const {data: rows, error} = await sb.from("recipes").select("id,source_url,image_url").in("source_url",sources);
    assert.equal(error,null);
    for (const row of rows || []) {
      assert.ok(sources.includes(row.source_url));
      if(row.image_url?.includes("/recipe-images/")) imagePaths.push(row.image_url.split("/recipe-images/")[1]);
      const {error} = await sb.from("recipes").delete().eq("id",row.id).eq("source_url",row.source_url); assert.equal(error,null);
    }
    if(imagePaths.length) { const {error} = await sb.storage.from("recipe-images").remove([...new Set(imagePaths)]); assert.equal(error,null); }
    const {data: remaining,error: verifyError} = await sb.from("recipes").select("id").in("source_url",sources);
    assert.equal(verifyError,null); assert.equal(remaining?.length,0);
    await unlink(file); checks.push("import fixtures and files removed");
    console.log(JSON.stringify({checks},null,2));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Import verification failed"); process.exitCode=1; });
