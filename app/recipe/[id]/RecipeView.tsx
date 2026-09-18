"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Nutrition, Recipe } from "@/lib/types";
import { getEditKey, hasEditKey, addToShopping, requestUnlock } from "@/lib/client";
import { CartLink } from "@/app/CartLink";
import { HeaderMenu } from "@/app/HeaderMenu";
import { scaleIngredient, scaleInstruction, SCALE_OPTIONS } from "@/lib/scale";
import { Icon } from "@/app/Icon";
import { IngredientChecklist } from "@/app/IngredientChecklist";
import { requestJson, requestMessage, jsonBody, validateImage, RequestError } from "@/lib/request";
import { recipeSource, recipeText } from "@/lib/recipe-format";
import { useDraftGuard } from "@/lib/use-draft-guard";
import { toast } from "@/app/Toast";

// Private drafts exist only in memory and are erased when access is locked.
const noteDrafts = new Map<string, string>();
const photoDrafts = new Map<string, File>();

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "انستغرام",
  facebook: "فيسبوك",
  tiktok: "تيك توك",
  youtube: "يوتيوب",
  video: "الفيديو",
  other: "المصدر",
};

function nutritionValue(value: number | null | undefined, scale: number, unit = "") {
  if (value == null) return "—";
  const scaled = value * scale;
  const rounded = unit ? Math.round(scaled * 10) / 10 : Math.round(scaled);
  return `${rounded}${unit}`;
}

export default function RecipeView({
  recipe,
  related = [],
}: {
  recipe: Recipe;
  related?: Recipe[];
}) {
  const router = useRouter();
  const [r, setR] = useState<Recipe>(recipe);
  const [editing, setEditing] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [checked, setCheckedState] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [added, setAdded] = useState(false);
  const [scale, setScale] = useState(1);
  const [notes, setNotes] = useState(recipe.notes || "");
  const [notesSaved, setNotesSaved] = useState(false);
  const actionBusy = useRef(false);
  const noteDraft = useRef(false);
  const [notesDirty, setNotesDirty] = useState(false);
  useDraftGuard(notesDirty);


  // Cook mode starts fresh (all unchecked) every visit.
  useEffect(() => {
    setCheckedState([]);
  }, [recipe.id]);

  useEffect(() => {
    let active = true;
    let pending: AbortController | null = null;
    const sync = () => {
      pending?.abort();
      const editable = hasEditKey(); setCanEdit(editable);
      if (!editable) {
        noteDrafts.clear(); noteDraft.current = false; setNotesDirty(false); setNotes(""); setNotesSaved(false);
        setR(c => ({...c, notes: null})); setEditing(false);
        return;
      }
      if (noteDrafts.has(recipe.id)) { noteDraft.current = true; setNotesDirty(true); setNotes(noteDrafts.get(recipe.id)!); }
      else { noteDraft.current = false; setNotesDirty(false); setNotes(""); setR(c => ({...c, notes: null})); }
      const key = getEditKey(); pending = new AbortController();
      const signal = pending.signal;
      requestJson<{notes: string | null}>(`/api/recipes/${recipe.id}`, {signal}).then(d => {
        if (!active || signal.aborted || !hasEditKey() || getEditKey() !== key || noteDraft.current) return;
        setNotes(d.notes || ""); setR(c => ({...c, notes: d.notes}));
      }).catch(e => { if (!signal.aborted) toast(requestMessage(e), "error"); });
    };
    sync(); window.addEventListener("editkey-changed", sync);
    return () => { active = false; pending?.abort(); window.removeEventListener("editkey-changed", sync); };
  }, [recipe.id]);

  useEffect(() => { setR(current => ({...recipe, notes: current.notes})); }, [recipe]);

  // Personal-field writer (favorite / rating / cooked / notes).
  const patch = async (fields: Record<string, unknown>): Promise<boolean> => {
    if (!hasEditKey()) { requestUnlock(); return false; }
    if (actionBusy.current) return false;
    actionBusy.current = true; setBusy(true);
    const key = getEditKey();
    try {
      const result = await requestJson<{recipe: Recipe}>(`/api/recipes/${r.id}`, {...jsonBody(fields), method: "PATCH"});
      if (hasEditKey() && getEditKey() === key) setR({...result.recipe, notes: noteDraft.current ? notes : result.recipe.notes});
      return hasEditKey() && getEditKey() === key;
    } catch(e) { toast(requestMessage(e), "error"); return false; }
    finally { actionBusy.current = false; setBusy(false); }
  };

  const completeNutrition = async (draft?: {title: string; ingredients: string[]; servings: string}): Promise<Nutrition | null> => {
    if (!hasEditKey()) { requestUnlock(); return null; }
    setBusy(true);
    try {
      const {nutrition} = await requestJson<{nutrition: Nutrition}>("/api/nutrition", jsonBody(draft ? {draft} : {id: r.id}), 65000);
      if (!draft) { setR(current => ({...current, nutrition})); toast("تم حفظ القيم الغذائية.", "success"); }
      return nutrition;
    } catch(e) { toast(requestMessage(e), "error"); return null; }
    finally { setBusy(false); }
  };

  // Keep the screen awake while viewing a recipe (handy while cooking).
  useEffect(() => {
    let lock: { release: () => void } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => void }> } };
    nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => lock?.release?.();
  }, []);

  const toggleFavorite = () => patch({ favorite: !r.favorite });

  const toggleCheck = (i: number) => {
    setCheckedState((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));
  };

  const platformLabel = PLATFORM_LABEL[r.platform || "other"] || "المصدر";
  const ingredients = r.ingredients || [];
  const steps = r.steps || [];
  const hasSource = recipeSource(r.source_url);

  const copyRecipe = async () => {
    try { await navigator.clipboard.writeText(recipeText(r, scale)); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toast("تعذّر النسخ. اسمح بالوصول إلى الحافظة ثم حاول مرة أخرى.", "error"); }
  };

  return (
    <div className="container recipe-page">
      <header className="recipe-topbar">
        <Link href="/" className="icon-btn" title="كل الوصفات" aria-label="رجوع">
          <Icon name="back" />
        </Link>
        <div className="topbar-actions">
          <button
            className={`icon-btn ${r.favorite ? "fav-on" : ""}`}
            disabled={busy} onClick={canEdit ? toggleFavorite : requestUnlock}
            title="المفضلة"
            aria-label="المفضلة"
              aria-pressed={!!r.favorite}
          >
            <Icon name={r.favorite ? "heartFilled" : "heart"} />
          </button>
          {canEdit && !editing && (
            <button
              className="icon-btn"
              onClick={() => setEditing(true)}
              title="تعديل الوصفة"
              aria-label="تعديل"
            >
              <Icon name="edit" />
            </button>
          )}
          <CartLink />
          <HeaderMenu />
        </div>
      </header>

      <main id="main-content">
      {editing ? (
        <EditForm
          r={r}
          busy={busy}
          onEstimateNutrition={completeNutrition}
          onCancel={() => setEditing(false)}
          onSave={async (fields, image) => {
            if (actionBusy.current) return false;
            actionBusy.current = true; setBusy(true);
            try {
              let init: RequestInit = {...jsonBody(fields), method: "PATCH"};
              if (image) { const form = new FormData(); form.append("data", JSON.stringify(fields)); form.append("image", image); init = {method: "PATCH", body: form}; }
              const {recipe: updated} = await requestJson<{recipe: Recipe}>(`/api/recipes/${r.id}`, init, 65000);
              setR({...updated, notes: noteDraft.current ? notes : updated.notes}); setEditing(false);
              toast("تم حفظ التعديلات.", "success"); router.refresh(); return true;
            } catch(e) { toast(requestMessage(e), "error"); return false; }
            finally { actionBusy.current = false; setBusy(false); }
          }}
          onDelete={async () => {
            if (!confirm("حذف هذه الوصفة نهائيًا؟")) return;
            setBusy(true);
            try { await requestJson(`/api/recipes/${r.id}`, {method: "DELETE"}); toast("تم حذف الوصفة.", "success"); router.push("/"); }
            catch(e) { toast(requestMessage(e), "error"); }
            finally { setBusy(false); }
          }}
        />
      ) : (
        <>
          {r.image_url && (
            <div className="hero-wrap">
              <Image
                src={r.image_url}
                alt={r.title || "وصفة"}
                fill
                sizes="420px"
                style={{ objectFit: "cover" }}
                priority
              />
            </div>
          )}

          <p className="print-only">الكمية: {scale}×{r.servings ? ` من ${r.servings}` : ""}</p>
          <h1 className="recipe-title">{r.title || "وصفة بدون عنوان"}</h1>

          <div className="recipe-sub">
            {r.author && <span>👤 {r.author}</span>}
            {r.servings && <span>🍽️ {r.servings}</span>}
            {r.time_minutes ? <span>⏱ {r.time_minutes} دقيقة</span> : null}
            {(r.tags || []).map((t) => (
              <Link className="chip clickable" key={t} href={`/?tag=${encodeURIComponent(t)}`}>
                #{t}
              </Link>
            ))}
            {(r.collections || []).map((c) => (
              <Link
                className="chip collection"
                key={c}
                href={`/?collection=${encodeURIComponent(c)}`}
              >
                <Icon name="folder" size={13} /> {c}
              </Link>
            ))}
          </div>

          <div className="recipe-actions no-print">
            {ingredients.length > 0 && (
              <button
                className="btn-ghost"
                onClick={async () => {
                try {
                  const accepted = await addToShopping(
                    r.id,
                    r.title || "وصفة",
                    ingredients.map((i) => scaleIngredient(i, scale))
                  );
                  if (!accepted) return;
                  setAdded(true);
                  setTimeout(() => setAdded(false), 1500);
                } catch(e) { toast(requestMessage(e), "error"); }
                }}
              >
                <Icon name="cart" size={17} /> {added ? "أضيفت" : "أضف للتسوق"}
              </button>
            )}
            <button className="btn-ghost" onClick={copyRecipe}>
              <Icon name={copied ? "check" : "copy"} size={17} /> {copied ? "تم النسخ" : "نسخ"}
            </button>
            <button className="btn-ghost" onClick={() => setTimeout(() => window.print(), 60)}>
              <Icon name="printer" size={17} /> طباعة
            </button>
            {canEdit && r.status !== "ok" && hasSource && (
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await requestJson("/api/web-save", jsonBody({url: hasSource}), 310000); router.refresh(); toast("تمت إعادة الاستخراج.", "success"); }
                  catch(e) { if (e instanceof RequestError && e.status === 409) router.refresh(); else toast(requestMessage(e), "error"); }
                  finally { setBusy(false); }
                }}
              >
                <Icon name="refresh" size={17} className={busy ? "spin" : ""} />{" "}
                {busy ? "جاري الاستخراج..." : "إعادة الاستخراج"}
              </button>
            )}
            {hasSource && (
              <a className="btn-primary" href={hasSource || undefined} target="_blank" rel="noopener noreferrer">
                <Icon name="external" size={17} /> شاهد على {platformLabel}
              </a>
            )}
          </div>

          {r.status !== "ok" && (
            <div className="note">
              {r.status === "needs_review"
                ? "⚠️ لم أتمكن من استخراج الوصفة تلقائيًا. فعّل وضع التحرير لإضافتها يدويًا، أو اضغط «إعادة الاستخراج»."
                : "⚠️ تعذّر الوصول إلى هذا المنشور (قد يكون خاصًا أو محذوفًا). الرابط الأصلي محفوظ بالأسفل."}
            </div>
          )}

          {(r.nutrition || canEdit) && (
            <section className="nutrition" aria-labelledby="nutrition-title">
              <div className="nutrition-head">
                <div>
                  <h2 id="nutrition-title">القيم الغذائية</h2>
                  <p>إجمالي الوصفة{scale !== 1 ? ` × ${scale}` : ""} · تقديري</p>
                </div>
                {canEdit && (
                  <button className="nutrition-edit" onClick={() => setEditing(true)}>
                    <Icon name="edit" size={15} /> تعديل القيم
                  </button>
                )}
              </div>
              <div className="nutrition-values">
                <div className={`nut-item ${r.nutrition?.calories == null ? "missing" : ""}`}>
                  <b>{nutritionValue(r.nutrition?.calories, scale)}</b>
                  <span>سعرة</span>
                </div>
                <div className={`nut-item ${r.nutrition?.protein_g == null ? "missing" : ""}`}>
                  <b>{nutritionValue(r.nutrition?.protein_g, scale, "غ")}</b>
                  <span>بروتين</span>
                </div>
                <div className={`nut-item ${r.nutrition?.carbs_g == null ? "missing" : ""}`}>
                  <b>{nutritionValue(r.nutrition?.carbs_g, scale, "غ")}</b>
                  <span>كربوهيدرات</span>
                </div>
                <div className={`nut-item ${r.nutrition?.fat_g == null ? "missing" : ""}`}>
                  <b>{nutritionValue(r.nutrition?.fat_g, scale, "غ")}</b>
                  <span>دهون</span>
                </div>
              </div>
              {canEdit &&
                (!r.nutrition ||
                  r.nutrition.calories == null ||
                  r.nutrition.protein_g == null ||
                  r.nutrition.carbs_g == null ||
                  r.nutrition.fat_g == null) && (
                  <button className="nutrition-complete" onClick={() => completeNutrition()} disabled={busy}>
                    <Icon name="refresh" size={15} className={busy ? "spin" : ""} />
                    {busy ? "جاري التقدير..." : "إكمال القيم الناقصة تلقائيًا"}
                  </button>
                )}
            </section>
          )}

          {ingredients.length > 0 && (
            <div className="section">
              <div className="section-head">
                <h2><Icon name="utensils" size={18} /> المكونات</h2>
                <span className="progress" role="status">
                  {checked.length}/{ingredients.length}
                </span>
              </div>
              <div className="scaler no-print">
                <span className="scaler-label">الكمية:</span>
                {SCALE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    aria-pressed={scale === o.value} className={`scale-btn ${scale === o.value ? "active" : ""}`}
                    onClick={() => setScale(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <IngredientChecklist ingredients={ingredients} sections={r.ingredient_sections} checked={checked} scale={scale} onToggle={toggleCheck} />
            </div>
          )}

          {steps.length > 0 && (
            <div className="section">
              <h2><Icon name="hat" size={18} /> طريقة التحضير</h2>
              <ol className="steps">
                {steps.map((s, i) => (
                  <li key={i}>{scaleInstruction(s, scale)}</li>
                ))}
              </ol>
            </div>
          )}

          {ingredients.length === 0 && steps.length === 0 && r.caption && (
            <div className="section">
              <h2>📝 النص الأصلي</h2>
              <div className="caption-raw">{r.caption}</div>
            </div>
          )}

          <div className="section no-print">
            <h2>ملاحظاتي وتقييمي</h2>
            {!canEdit && <p className="helper-text">فعّل التحرير لحفظ المفضلة والتقييم والملاحظات. <button className="link-btn" onClick={requestUnlock}>تفعيل التحرير</button></p>}
            <fieldset className="personal-fields" disabled={!canEdit || busy}>
            <div className="personal-row">
              <div className="stars" title="تقييم">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className="star-btn" aria-pressed={n === r.rating}
                    onClick={() => patch({ rating: r.rating === n ? null : n })}
                    aria-label={`${n} نجوم`}
                  >
                    {n <= (r.rating || 0) ? "★" : "☆"}
                  </button>
                ))}
              </div>
              <button
                aria-pressed={!!r.cooked} className={`chip-toggle ${r.cooked ? "active" : ""}`}
                onClick={() => patch({ cooked: !r.cooked })}
              >
                <Icon name="check" size={16} /> {r.cooked ? "طبختها" : "علّمها كمطبوخة"}
              </button>
            </div>
            <textarea
              aria-label="ملاحظاتي على الوصفة"
              className="notes-area"
              placeholder="ملاحظاتي وتعديلاتي على الوصفة..."
              value={notes}
              onChange={(e) => {
                noteDrafts.set(r.id, e.target.value); noteDraft.current = true; setNotesDirty(true); setNotes(e.target.value);
                setNotesSaved(false);
              }}
              rows={3}
            />
            <button
              className="btn-ghost"
              onClick={async () => {
                if (await patch({ notes })) {
                  noteDrafts.clear(); noteDrafts.delete(r.id); noteDraft.current = false; setNotesDirty(false); setNotesSaved(true);
                  toast("تم حفظ الملاحظة.", "success");
                }
              }}
            >
              {notesSaved ? "✓ حُفظت" : "حفظ الملاحظة"}
            </button>
            </fieldset>
          </div>

          {related.length > 0 && (
            <div className="section no-print">
              <h2><Icon name="utensils" size={18} /> وصفات مشابهة</h2>
              <div className="related-grid">
                {related.map((rec) => (
                  <Link href={`/recipe/${rec.id}`} key={rec.id} className="related-card">
                    <div className="related-img-wrap">
                      {rec.image_url ? (
                        <Image
                          src={rec.image_url}
                          alt=""
                          fill
                          sizes="150px"
                          style={{ objectFit: "cover" }}
                        />
                      ) : (
                        <div className="related-ph"><Icon name="hat" size={28} /></div>
                      )}
                    </div>
                    <span>{rec.title || "وصفة"}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      </main>

    </div>
  );
}

function EditForm({
  r,
  busy,
  onSave,
  onCancel,
  onDelete,
  onEstimateNutrition,
}: {
  r: Recipe;
  busy: boolean;
  onSave: (patch: Record<string, unknown>, image?: File) => Promise<boolean>;
  onCancel: () => void;
  onDelete: () => void;
  onEstimateNutrition: (draft: {title: string; ingredients: string[]; servings: string}) => Promise<Nutrition | null>;
}) {
  const [title, setTitle] = useState(r.title || "");
  const [author, setAuthor] = useState(r.author || "");
  const [servings, setServings] = useState(r.servings || "");
  const [time, setTime] = useState(r.time_minutes ? String(r.time_minutes) : "");
  const [tags, setTags] = useState((r.tags || []).join("، "));
  const [collections, setCollections] = useState((r.collections || []).join("، "));
  const [ingredients, setIngredients] = useState((r.ingredients || []).join("\n"));
  const [steps, setSteps] = useState((r.steps || []).join("\n"));
  const [calories, setCalories] = useState(r.nutrition?.calories?.toString() || "");
  const [protein, setProtein] = useState(r.nutrition?.protein_g?.toString() || "");
  const [carbs, setCarbs] = useState(r.nutrition?.carbs_g?.toString() || "");
  const [fat, setFat] = useState(r.nutrition?.fat_g?.toString() || "");

  const [photo, setPhoto] = useState<File | undefined>(() => photoDrafts.get(r.id));
  const [draftReady, setDraftReady] = useState(false);
  const [restored, setRestored] = useState(false);
  const [preview, setPreview] = useState(r.image_url || "");
  const [error, setError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!photo) { setPreview(r.image_url || ""); return; } const url = URL.createObjectURL(photo); setPreview(url); return () => URL.revokeObjectURL(url); }, [photo, r.image_url]);
  const dirty = !!photo || title !== (r.title || "") || author !== (r.author || "") || servings !== (r.servings || "") || time !== (r.time_minutes ? String(r.time_minutes) : "") || tags !== (r.tags || []).join("، ") || collections !== (r.collections || []).join("، ") || ingredients !== (r.ingredients || []).join("\n") || steps !== (r.steps || []).join("\n") || calories !== (r.nutrition?.calories?.toString() || "") || protein !== (r.nutrition?.protein_g?.toString() || "") || carbs !== (r.nutrition?.carbs_g?.toString() || "") || fat !== (r.nutrition?.fat_g?.toString() || "");
  useDraftGuard(dirty);
  const draftKey = `recipebox-draft:${r.id}`;
  const discard = () => { sessionStorage.removeItem(draftKey); photoDrafts.delete(r.id); onCancel(); };
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) || "null");
      if (saved && typeof saved === "object") {
        const setters: Record<string, (v: string) => void> = {title: setTitle, author: setAuthor, servings: setServings, time: setTime, tags: setTags, collections: setCollections, ingredients: setIngredients, steps: setSteps, calories: setCalories, protein: setProtein, carbs: setCarbs, fat: setFat};
        for (const [key, setter] of Object.entries(setters)) if (typeof saved[key] === "string") setter(saved[key]);
        setRestored(true);
      }
    } catch {} finally { setDraftReady(true); }
  }, [draftKey]);
  useEffect(() => {
    if (!draftReady) return;
    try {
      if (dirty) sessionStorage.setItem(draftKey, JSON.stringify({title, author, servings, time, tags, collections, ingredients, steps, calories, protein, carbs, fat}));
      else sessionStorage.removeItem(draftKey);
      if (photo) photoDrafts.set(r.id, photo); else photoDrafts.delete(r.id);
    } catch { setError("تعذّر حفظ المسودة على هذا الجهاز. لا تغادر قبل حفظ التغييرات."); }
  }, [draftReady, dirty, draftKey, r.id, title, author, servings, time, tags, collections, ingredients, steps, calories, protein, carbs, fat, photo]);
  const toNumber = (value: string) => (value.trim() === "" ? null : Number(value));
  const save = async () => {
    setError("");
    if (!title.trim() || !ingredients.trim() || !steps.trim()) { setError("أدخل عنوانًا ومكونات وخطوات قبل حفظ وصفة مكتملة."); return; }
    if (time && (!Number.isFinite(Number(time)) || Number(time) < 0)) { setError("أدخل وقتًا صالحًا."); return; }
    const nutrition = {
      calories: toNumber(calories),
      protein_g: toNumber(protein),
      carbs_g: toNumber(carbs),
      fat_g: toNumber(fat),
    };
    if (Object.values(nutrition).some(v => v != null && (!Number.isFinite(v) || v < 0))) { setError("القيم الغذائية يجب أن تكون أرقامًا موجبة."); return; }
    const fields: Record<string, unknown> = {
      title: title.trim(),
      author,
      servings,
      time_minutes: time ? Number(time) : null,
      tags: tags.split(/[،,\n]/).map((s) => s.trim()).filter(Boolean),
      collections: collections.split(/[،,\n]/).map((s) => s.trim()).filter(Boolean),
      ingredients: ingredients.split("\n").map((s) => s.trim()).filter(Boolean),
      steps: steps.split("\n").map((s) => s.trim()).filter(Boolean),
      nutrition: Object.values(nutrition).every((value) => value == null) ? null : nutrition,
      status: "ok",
    };
    const changes = Object.fromEntries(Object.entries(fields).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(r[key as keyof Recipe])));
    if (!Object.keys(changes).length && !photo) { discard(); return; }
    if (await onSave(changes, photo)) { sessionStorage.removeItem(draftKey); photoDrafts.delete(r.id); }
  };

  const estimateNutrition = async () => {
    const nutrition = await onEstimateNutrition({title, ingredients: ingredients.split("\n").map(s => s.trim()).filter(Boolean), servings});
    if (!nutrition) return;
    setCalories(current => current || nutrition.calories?.toString() || "");
    setProtein(current => current || nutrition.protein_g?.toString() || "");
    setCarbs(current => current || nutrition.carbs_g?.toString() || "");
    setFat(current => current || nutrition.fat_g?.toString() || "");
  };

  return (
    <form className="edit-form" onSubmit={e => { e.preventDefault(); if (!busy) save(); }}>
      <h1>تعديل الوصفة</h1>
      <p className="helper-text">تُحفظ الصورة والقيم والتعديلات عند الضغط على حفظ.</p>
      {restored && <p role="status" className="helper-text">تمت استعادة مسودتك غير المحفوظة.</p>}
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="edit-photo">
        <div className="edit-photo-preview">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={`صورة ${r.title || "الوصفة"}`} className="recipe-hero" />
          ) : (
            <div className="recipe-hero placeholder-hero">🍲</div>
          )}
        </div>
        <button type="button" className="photo-change-button" onClick={() => photoInput.current?.click()} disabled={busy}>
          <span className="photo-change-icon"><Icon name="camera" size={20} /></span>
          <span>
            <strong>{r.image_url ? "استبدال صورة الوصفة" : "إضافة صورة للوصفة"}</strong>
            <small>اختر صورة JPG أو PNG أو WebP حتى 10 ميجابايت</small>
          </span>
        </button>
      </div>

      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; try { validateImage(file, 10); setPhoto(file); setError(""); } catch(e) { setError(requestMessage(e)); } }} />
      {photo && <button type="button" className="link-btn" onClick={() => setPhoto(undefined)}>إلغاء تغيير الصورة</button>}
      <label htmlFor="edit-title">العنوان</label>
      <input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />

      <div className="edit-row">
        <div>
          <label htmlFor="edit-author">الطاهي / المصدر</label>
          <input id="edit-author" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div>
          <label htmlFor="edit-servings">الحصص</label>
          <input id="edit-servings" value={servings} onChange={(e) => setServings(e.target.value)} />
        </div>
        <div>
          <label htmlFor="edit-time">الوقت (دقيقة)</label>
          <input
            id="edit-time" min="0" type="number"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      </div>

      <fieldset className="nutrition-editor">
        <legend>القيم الغذائية</legend>
        <div className="nutrition-editor-head">
          <div>
            <p>إجمالي الوصفة كاملة، وليست للحصة الواحدة.</p>
          </div>
          <button type="button" className="btn-ghost" onClick={estimateNutrition} disabled={busy}>
            <Icon name="refresh" size={15} className={busy ? "spin" : ""} />
            {busy ? "جاري التقدير..." : "إكمال الناقص تلقائيًا"}
          </button>
        </div>
        <div className="macro-grid">
          <label htmlFor="nutrition-calories">
            السعرات
            <input id="nutrition-calories" type="number" min="0" step="1" value={calories} onChange={(e) => setCalories(e.target.value)} />
          </label>
          <label htmlFor="nutrition-protein">
            البروتين (غ)
            <input id="nutrition-protein" type="number" min="0" step="0.1" value={protein} onChange={(e) => setProtein(e.target.value)} />
          </label>
          <label htmlFor="nutrition-carbs">
            الكربوهيدرات (غ)
            <input id="nutrition-carbs" type="number" min="0" step="0.1" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
          </label>
          <label htmlFor="nutrition-fat">
            الدهون (غ)
            <input id="nutrition-fat" type="number" min="0" step="0.1" value={fat} onChange={(e) => setFat(e.target.value)} />
          </label>
        </div>
      </fieldset>

      <label htmlFor="edit-tags">الوسوم (افصل بفاصلة)</label>
      <input id="edit-tags" value={tags} onChange={(e) => setTags(e.target.value)} />

      <label htmlFor="edit-collections">المجموعات (عشاء، حلويات، رمضان...)</label>
      <input id="edit-collections" value={collections} onChange={(e) => setCollections(e.target.value)} />

      <label htmlFor="edit-ingredients">المكونات (سطر لكل مكوّن)</label>
      <textarea
        id="edit-ingredients" rows={8}
        value={ingredients}
        onChange={(e) => setIngredients(e.target.value)}
      />

      <label htmlFor="edit-steps">الخطوات (سطر لكل خطوة)</label>
      <textarea id="edit-steps" rows={10} value={steps} onChange={(e) => setSteps(e.target.value)} />

      <div className="edit-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          <Icon name={busy ? "refresh" : "check"} size={17} className={busy ? "spin" : ""} />{" "}
          {busy ? "جاري الحفظ..." : "حفظ"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => { if (!dirty || confirm("تجاهل التغييرات غير المحفوظة؟")) discard(); }} disabled={busy}>
          إلغاء
        </button>
        <button type="button" className="btn-danger" onClick={onDelete} disabled={busy}>
          <Icon name="trash" size={17} /> حذف الوصفة
        </button>
      </div>
    </form>
  );
}
