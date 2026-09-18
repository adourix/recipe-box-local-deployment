"use client";

import { replaceRecipeItems, type ShopItem } from "./shopping";
export type { ShopItem } from "./shopping";
const KEY = "recipebox_edit_key";
let verifiedKey = "";
let revision = 0;
export function getEditKey(): string {
  try { return typeof window === "undefined" ? "" : localStorage.getItem(KEY) || ""; } catch { return ""; }
}
export function hasEditKey() { return !!verifiedKey && verifiedKey === getEditKey(); }
export function setEditKey(value: string) {
  revision++; verifiedKey = "";
  if (typeof window === "undefined") return;
  try { if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY); }
  finally { window.dispatchEvent(new Event("editkey-changed")); }
}
export function invalidateAccess() { revision++; verifiedKey = ""; window.dispatchEvent(new Event("editkey-changed")); }
export function requestUnlock() { window.dispatchEvent(new Event("edit-requested")); }
export async function verifyEditKey(candidate: string) {
  const started = revision;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch("/api/access", { headers: { "x-edit-key": candidate }, signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      if (res.status === 401) {
        if (getEditKey() === candidate) setEditKey("");
        throw new Error("مفتاح التحرير غير صحيح. أعد إدخاله.");
      }
      throw new Error("تعذّر التحقق الآن. حاول مرة أخرى.");
    }
    if (started !== revision && !(hasEditKey() && getEditKey() === candidate)) throw new Error("تم إيقاف التحقق. حاول مرة أخرى.");
    localStorage.setItem(KEY, candidate);
    verifiedKey = candidate;
    window.dispatchEvent(new Event("editkey-changed"));
  } catch (error) {
    if (error instanceof TypeError || controller.signal.aborted) throw new Error("تعذّر الاتصال للتحقق من المفتاح. حاول مرة أخرى.");
    throw error;
  } finally { clearTimeout(timer); }
}

const SHOP = "recipebox_shopping";
export function getShopping(): ShopItem[] {
  try {
    const value = JSON.parse(localStorage.getItem(SHOP) || "[]");
    return Array.isArray(value) ? value.filter(i => i && typeof i.text === "string" && typeof i.recipeId === "string").map(i => ({...i, checked: !!i.checked})) : [];
  } catch { return []; }
}
export async function updateShopping(change: (items: ShopItem[]) => ShopItem[]) {
  const commit = () => {
    const items = change(getShopping());
    localStorage.setItem(SHOP, JSON.stringify(items));
    window.dispatchEvent(new Event("shopping-changed"));
    return items;
  };
  if (navigator.locks) return navigator.locks.request("recipebox-shopping", commit);
  return commit();
}
export async function addToShopping(recipeId: string, title: string, ingredients: string[]) {
  let accepted = false;
  await updateShopping(items => {
    const prior = items.filter(i => i.recipeId === recipeId);
    if (prior.length && JSON.stringify(prior.map(i => i.text)) !== JSON.stringify([...new Set(ingredients)]) &&
        !confirm("هذه الوصفة موجودة في القائمة بكمية مختلفة. استبدالها بالكمية الحالية؟")) return items;
    accepted = true;
    return replaceRecipeItems(items, recipeId, title, ingredients);
  });
  return accepted;
}
export function setShopping(items: ShopItem[]) { return updateShopping(() => items); }
export function shoppingCount() { return getShopping().length; }
