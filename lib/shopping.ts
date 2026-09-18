export interface ShopItem { text: string; from: string; recipeId: string; checked: boolean; }
export const shoppingKey = (item: ShopItem) => JSON.stringify([item.recipeId, item.text]);

/** One current ingredient batch per recipe. Unchanged rows retain check state. */
export function replaceRecipeItems(items: ShopItem[], recipeId: string, title: string, ingredients: string[]): ShopItem[] {
  const previous = new Map(items.filter(i => i.recipeId === recipeId).map(i => [i.text, i.checked]));
  return [...items.filter(i => i.recipeId !== recipeId), ...[...new Set(ingredients)].map(text => ({
    text, from: title, recipeId, checked: previous.get(text) ?? false,
  }))];
}
