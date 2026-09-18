"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getShopping, updateShopping, type ShopItem } from "@/lib/client";
import { toast } from "@/app/Toast";
import { HeaderMenu } from "@/app/HeaderMenu";
import { shoppingKey } from "@/lib/shopping";
import { requestMessage } from "@/lib/request";
import { Icon } from "@/app/Icon";

export default function ShoppingClient() {
  const [items, setItems] = useState<ShopItem[]>([]);

  useEffect(() => {
    const sync = () => setItems(getShopping()); sync();
    window.addEventListener("shopping-changed", sync); window.addEventListener("storage", sync); window.addEventListener("focus", sync);
    return () => { window.removeEventListener("shopping-changed", sync); window.removeEventListener("storage", sync); window.removeEventListener("focus", sync); };
  }, []);
  const update = async (change: (items: ShopItem[]) => ShopItem[]) => {
    setItems(change(getShopping()));
    try { setItems(await updateShopping(change)); } catch (e) { setItems(getShopping()); toast(requestMessage(e), "error"); }
  };
  const toggle = (i: number, checked: boolean) => { const key = shoppingKey(items[i]); return update(current => current.map(it => shoppingKey(it) === key ? {...it, checked} : it)); };
  const remove = (i: number) => { const key = shoppingKey(items[i]); return update(current => current.filter(it => shoppingKey(it) !== key)); };
  const clearChecked = () => update(current => current.filter(it => !it.checked));
  const clearAll = () => { if (confirm("مسح قائمة التسوق بالكامل؟")) update(() => []); };

  const groups = useMemo(() => {
    const g = new Map<string, { title: string; entries: { it: ShopItem; i: number }[] }>();
    items.forEach((it, i) => {
      const key = it.recipeId;
      if (!g.has(key)) g.set(key, { title: it.from, entries: [] });
      g.get(key)!.entries.push({ it, i });
    });
    return [...g.values()];
  }, [items]);

  const doneCount = items.filter((i) => i.checked).length;

  const copyList = async () => {
    const txt = items.map((i) => `${i.checked ? "✓" : "•"} ${i.text}`).join("\n");
    try { await navigator.clipboard.writeText("قائمة التسوق:\n" + txt); toast("تم نسخ القائمة.", "success"); }
    catch { toast("تعذّر النسخ. حاول مرة أخرى.", "error"); }
  };

  return (
    <div className="container">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo cart-logo"><Icon name="cart" size={22} /></span>
          <div>
            <h1>قائمة التسوق</h1>
            <span className="count">
              {items.length} عنصر · {doneCount} مكتمل
            </span>
          </div>
        </div>
        <div className="header-actions"><HeaderMenu /><Link href="/" className="btn-ghost">
          <Icon name="back" size={16} /> المعرض
        </Link></div>
      </header>
      <main id="main-content">
      <p className="helper-text">قائمتك محفوظة على هذا الجهاز. علّم المكونات أثناء التسوق.</p>

      {items.length === 0 ? (
        <div className="empty">
          <div className="big"><Icon name="cart" size={48} /></div>
          <p>
            القائمة فارغة. افتح أي وصفة واضغط «أضف للتسوق» لإضافة مكوّناتها هنا.
          </p>
          <Link href="/" className="btn-primary">تصفح الوصفات</Link>
        </div>
      ) : (
        <>
          <div className="recipe-actions no-print">
            <button className="btn-ghost" onClick={copyList}>
              <Icon name="copy" size={16} /> نسخ القائمة
            </button>
            <button className="btn-ghost" onClick={clearChecked} disabled={!doneCount}>
              مسح المكتمل
            </button>
            <button className="btn-danger" onClick={clearAll}>
              مسح الكل
            </button>
          </div>

          {groups.map((g) => (
            <div className="section" key={g.title + g.entries[0].i}>
              <h2><Icon name="hat" size={17} /> {g.title}</h2>
              <ul className="ingredients">
                {g.entries.map(({ it, i }) => (
                  <li key={i} className={it.checked ? "done" : ""}>
                    <label className="check-label"><input type="checkbox" checked={it.checked} onChange={e => toggle(i, e.target.checked)} /><span className="tick" aria-hidden="true">{it.checked ? "✓" : ""}</span><span>{it.text}</span></label>
                    <button className="mini-x" onClick={() => remove(i)} aria-label={`حذف ${it.text}`}>
                      <Icon name="x" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
      </main>
    </div>
  );
}
