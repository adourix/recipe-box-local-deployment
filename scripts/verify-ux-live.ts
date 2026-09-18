import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../lib/supabase";

async function main() {
  loadEnvConfig(process.cwd());
  const base = process.env.UX_TEST_URL || "http://127.0.0.1:3002";
  const key = process.env.EDIT_KEY;
  assert.ok(key, "Edit key is required");
  const sb = supabaseAdmin();
  const id = randomUUID();
  const source = `https://example.com/recipebox-ux-verification/${id}`;
  const path = `/api/recipes/${id}`;
  const checks: string[] = [];
  let created = false;
  let imagePath: string | undefined;
  try {
    const {error} = await sb.from("recipes").insert({id, title:`UI verification ${id}`, source_url:source,
      platform:"other", ingredients:["1 كوب أرز", "2 كوب ماء"], steps:["اطبخ الأرز في الماء لمدة 20 دقيقة"],
      tags:["اختبار واجهة مؤقت"], status:"ok", nutrition:{calories:200,protein_g:4,carbs_g:45,fat_g:1}, lang:"ar"});
    assert.equal(error, null, "Fixture insert failed"); created = true;
    const access = await fetch(`${base}/api/access`, {headers:{"x-edit-key":key}});
    assert.equal(access.status, 200); checks.push("verified access");
    const denied = await fetch(`${base}${path}`, {method:"PATCH",headers:{"x-edit-key":"invalid", "content-type":"application/json"},body:JSON.stringify({title:"must not save"})});
    assert.equal(denied.status, 401); checks.push("invalid key denied");
    const saved = await fetch(`${base}${path}`, {method:"PATCH",headers:{"x-edit-key":key, "content-type":"application/json"},body:JSON.stringify({title:`UI verified ${id}`,notes:"temporary private fixture",favorite:true,rating:4,cooked:true})});
    assert.equal(saved.status, 200, "Save failed");
    const record = (await saved.json()).recipe;
    assert.equal(record.favorite, true); assert.equal(record.rating, 4); checks.push("title/favorite/rating/cooked save");
    const notes = await fetch(`${base}${path}`, {headers:{"x-edit-key":key}});
    assert.equal((await notes.json()).notes, "temporary private fixture"); checks.push("private notes read");
    const bad = await fetch(`${base}${path}`, {method:"PATCH",headers:{"x-edit-key":key, "content-type":"application/json"},body:JSON.stringify({ingredients:[], status:"ok"})});
    assert.equal(bad.status, 400); checks.push("incomplete recipe rejected");
    const form = new FormData(); form.append("data", JSON.stringify({author:"UI verification"}));
    form.append("image", new Blob([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1sAAAAASUVORK5CYII=", "base64")], {type:"image/png"}), "fixture.png");
    const image = await fetch(`${base}${path}`, {method:"PATCH",headers:{"x-edit-key":key},body:form});
    assert.equal(image.status, 200, "Image save failed");
    const url = (await image.json()).recipe.image_url;
    imagePath = url.split("/recipe-images/")[1]; assert.ok(imagePath?.startsWith(id));
    assert.equal((await fetch(url)).status, 200); checks.push("atomic form + image save and public image read");
    const backup = await fetch(`${base}/api/export`, {headers:{"x-edit-key":key}});
    assert.equal(backup.status, 200); assert.ok((await backup.json()).some((r: {id:string})=>r.id===id)); checks.push("real export includes saved fixture");
    const preview = await fetch(`${base}/api/nutrition`, {method:"POST",headers:{"x-edit-key":key,"content-type":"application/json"},body:JSON.stringify({draft:{title:"خيار",ingredients:["100 غرام خيار"],servings:"حصة واحدة"}})});
    if (preview.ok) {
      assert.ok((await preview.json()).nutrition); checks.push("live nutrition draft estimate");
    } else checks.push(`nutrition provider unavailable (${preview.status}); recovery required`);
    const {data: after} = await sb.from("recipes").select("nutrition").eq("id",id).single();
    assert.deepEqual(after?.nutrition, {calories:200,protein_g:4,carbs_g:45,fat_g:1}); checks.push("nutrition preview did not persist");
    const removed = await fetch(`${base}${path}`, {method:"DELETE",headers:{"x-edit-key":key}});
    assert.equal(removed.status,200); checks.push("delete endpoint");
  } finally {
    if (created) {
      const {data: current} = await sb.from("recipes").select("id,source_url").eq("id", id).maybeSingle();
      if (current) {
        assert.equal(current.source_url, source, "Refusing to clean up an unrelated record");
        const {error} = await sb.from("recipes").delete().eq("id",id).eq("source_url",source); assert.equal(error,null);
      }
      if (imagePath) { const {error} = await sb.storage.from("recipe-images").remove([imagePath]); assert.equal(error,null); }
      const {data, error} = await sb.from("recipes").select("id").eq("id",id).maybeSingle();
      assert.equal(error,null); assert.equal(data,null); checks.push("fixture cleanup verified");
    }
    console.log(JSON.stringify({checks},null,2));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Live verification failed"); process.exitCode = 1; });
