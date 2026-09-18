import type { Recipe } from "./types";
import { scaleIngredient, scaleInstruction } from "./scale";

export function recipeSource(value: string | null | undefined) {
  try { const url = new URL(value || ""); return ["http:", "https:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export function recipeText(recipe: Recipe, scale: number) {
  const source = recipeSource(recipe.source_url);
  return [recipe.title, `الكمية: ${scale}×${recipe.servings ? ` من ${recipe.servings}` : ""}`, "", "المكونات:",
    ...recipe.ingredients.map(i => `- ${scaleIngredient(i, scale)}`), "", "الطريقة:",
    ...recipe.steps.map((s, i) => `${i + 1}. ${scaleInstruction(s, scale)}`), source ? `\nالمصدر: ${source}` : ""].join("\n");
}
