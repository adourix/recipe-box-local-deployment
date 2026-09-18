import { test } from "node:test";
import assert from "node:assert/strict";
import { replaceRecipeItems, type ShopItem } from "../lib/shopping";
import { recipeSource, recipeText } from "../lib/recipe-format";
import { requestJson, RequestError, validateImage } from "../lib/request";
import type { Recipe } from "../lib/types";

test("changing a recipe quantity replaces its batch and preserves other recipes", () => {
  const list: ShopItem[] = [
    {recipeId:"a", from:"A", text:"1 cup rice", checked:true},
    {recipeId:"b", from:"B", text:"1 onion", checked:true},
  ];
  const next = replaceRecipeItems(list, "a", "A", ["2 cups rice", "2 cups rice"]);
  assert.equal(next.length, 2);
  assert.equal(next[0].recipeId, "b");
  assert.equal(next[0].checked, true);
  assert.equal(next[1].text, "2 cups rice");
  assert.equal(next[1].checked, false);
  assert.equal(list.length, 2);
});

test("re-adding unchanged ingredients retains completed shopping checks", () => {
  const list = [{recipeId:"a", from:"A", text:"1 cup rice", checked:true}];
  assert.equal(replaceRecipeItems(list, "a", "A", ["1 cup rice"])[0].checked, true);
});

test("upload sentinels and unsafe/non-web URLs never become recipe source links", () => {
  for (const value of ["photo-upload", "video-upload", "javascript:alert(1)", "/photo-upload", ""]) assert.equal(recipeSource(value), null);
  assert.equal(recipeSource("https://example.com/recipe"), "https://example.com/recipe");
});

test("copy follows selected quantities and preserves cooking time", () => {
  const recipe = {title:"أرز", servings:"4 حصص", source_url:"photo-upload", ingredients:["1 كوب أرز"], steps:["أضف 1 كوب أرز واطبخ لمدة 20 دقيقة"]} as Recipe;
  const text = recipeText(recipe, 2);
  assert.match(text, /2 كوب أرز/);
  assert.match(text, /20 دقيقة/);
  assert.match(text, /2×/);
  assert.doesNotMatch(text, /photo-upload/);
});

test("requests preserve duplicate metadata, report network failures and reject malformed success", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({id:"existing"}), {status:409});
    await assert.rejects(requestJson("/api/test"), e => e instanceof RequestError && e.status === 409 && e.data.id === "existing");
    globalThis.fetch = async () => { throw new TypeError("network failure"); };
    await assert.rejects(requestJson("/api/test"), /تعذّر الاتصال/);
    globalThis.fetch = async () => new Response("not json", {status:200});
    await assert.rejects(requestJson("/api/test"), /رد غير صالح/);
  } finally { globalThis.fetch = original; }
});

test("image validation rejects unsupported files and oversize uploads", () => {
  assert.throws(() => validateImage(new File(["not an image"], "test.txt", {type:"text/plain"}), 12), /JPG/);
  assert.throws(() => validateImage(new File([new Uint8Array(1024 * 1024 + 1)], "large.png", {type:"image/png"}), 1), /ميجابايت/);
  assert.doesNotThrow(() => validateImage(new File(["fixture"], "test.png", {type:"image/png"}), 1));
});
