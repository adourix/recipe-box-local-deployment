"use client";
import type { IngredientSection } from "@/lib/types";
import { scaleIngredient } from "@/lib/scale";

export function IngredientChecklist({ ingredients, sections, checked, scale, onToggle }: {
  ingredients: string[]; sections: IngredientSection[] | null; checked: number[]; scale: number; onToggle: (i: number) => void;
}) {
  const groups = sections?.length ? sections : [{ title: "", items: ingredients }];
  let offset = 0;
  return groups.map((group, groupIndex) => {
    const start = offset; offset += group.items.length;
    return <div className="ing-group" key={groupIndex}>
      {group.title && <h3 className="ing-section">{group.title}</h3>}
      <ul className="ingredients">{group.items.map((item, i) => <li key={i} className={checked.includes(start + i) ? "done" : ""}>
        <label className="check-label"><input type="checkbox" checked={checked.includes(start + i)} onChange={() => onToggle(start + i)} />
          <span className="tick" aria-hidden="true">{checked.includes(start + i) ? "✓" : ""}</span>
          <span>{scaleIngredient(item, scale)}</span></label>
      </li>)}</ul>
    </div>;
  });
}
