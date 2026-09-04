"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Nutrition, Recipe } from "@/lib/types";
import { getEditKey, hasEditKey, addToShopping } from "@/lib/client";
import { CartLink } from "@/app/CartLink";
import { HeaderMenu } from "@/app/HeaderMenu";
import { scaleIngredient, scaleInstruction, SCALE_OPTIONS } from "@/lib/scale";
import { Icon } from "@/app/Icon";
import { toast } from "@/app/Toast";

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
  const fileRef = useRef<HTMLInputElement>(null);

  // Cook mode starts fresh (all unchecked) every visit.
  useEffect(() => {
    setCheckedState([]);
  }, [recipe.id]);

  // Reflect the unlock state live (no reload) + load private notes when unlocked.
  useEffect(() => {
    const sync = () => {
      const editable = hasEditKey();
      setCanEdit(editable);
      if (editable) {
        fetch(`/api/recipes/${recipe.id}`, { headers: { "x-edit-key": getEditKey() } })
          .then((res) => (res.ok ? res.json() : null))
          .then((d) => {
            if (d && typeof d.notes === "string") {
              setNotes(d.notes);
              setR((c) => ({ ...c, notes: d.notes }));
            }
          })
          .catch(() => {});
      }
    };
    sync();
    window.addEventListener("editkey-changed", sync);
    return () => window.removeEventListener("editkey-changed", sync);
  }, [recipe.id]);

  // Keep in sync when the server re-renders (e.g. after retry via router.refresh).
  useEffect(() => {
    setR(recipe);
    setNotes(recipe.notes || "");
  }, [recipe]);

  // Personal-field writer (favorite / rating / cooked / notes).
  const patch = async (fields: Record<string, unknown>): Promise<boolean> => {
    if (!hasEditKey()) {
      toast("فعّل وضع التحرير أولًا (زر القفل).", "error");
      return false;
    }
    const prev: Record<string, unknown> = {};
    for (const k of Object.keys(fields)) prev[k] = (r as unknown as Record<string, unknown>)[k];
    setR((c) => ({ ...c, ...fields }));
    const res = await fetch(`/api/recipes/${r.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-edit-key": getEditKey() },
      body: JSON.stringify(fields),
    }).catch(() => null);
    if (!res || !res.ok) {
      setR((c) => ({ ...c, ...prev })); // revert optimistic change
      toast("تعذّر الحفظ.", "error");
      return false;
    }
    return true;
  };

  const completeNutrition = async (): Promise<Nutrition | null> => {
    if (!hasEditKey()) {
      toast("فعّل وضع التحرير أولًا (زر القفل).", "error");
      return null;
    }
    setBusy(true);
    const res = await fetch("/api/nutrition", {
      method: "POST",
      headers: { "content-type": "application/json", "x-edit-key": getEditKey() },
      body: JSON.stringify({ id: r.id }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      toast("تعذّر تقدير القيم الغذائية الآن.", "error");
      return null;
    }
    const { nutrition } = (await res.json()) as { nutrition: Nutrition };
    setR((current) => ({ ...current, nutrition }));
    toast("تم إكمال القيم الغذائية الناقصة.", "success");
    return nutrition;
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
  const hasSource = r.source_url && r.source_url !== "video-upload";

  const copyRecipe = () => {
    const txt = [
      r.title,
      "",
      "المكونات:",
      ...ingredients.map((x) => `- ${x}`),
      "",
      "الطريقة:",
      ...steps.map((x, i) => `${i + 1}. ${x}`),
      hasSource ? `\nالمصدر: ${r.source_url}` : "",
    ].join("\n");
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="container recipe-page">
      <div className="recipe-topbar">
        <Link href="/" className="icon-btn" title="كل الوصفات" aria-label="رجوع">
          <Icon name="back" />
        </Link>
        <div className="topbar-actions">
          <button
            className={`icon-btn ${r.favorite ? "fav-on" : ""}`}
            onClick={toggleFavorite}
            title="المفضلة"
            aria-label="المفضلة"
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
      </div>

      <main>
      {editing ? (
        <EditForm
          r={r}
          busy={busy}
          onImage={() => fileRef.current?.click()}
          onEstimateNutrition={completeNutrition}
          onCancel={() => setEditing(false)}
          onSave={async (patch) => {
            setBusy(true);
            const res = await fetch(`/api/recipes/${r.id}`, {
              method: "PATCH",
              headers: {
                "content-type": "application/json",
                "x-edit-key": getEditKey(),
              },
              body: JSON.stringify(patch),
            });
            setBusy(false);
            if (res.ok) {
              const { recipe: updated } = await res.json();
              setR(updated);
              setEditing(false);
              router.refresh();
              toast("تم حفظ التعديلات.", "success");
            } else {
              toast("فشل الحفظ — تأكد من مفتاح التحرير.", "error");
            }
          }}
          onDelete={async () => {
            if (!confirm("حذف هذه الوصفة نهائيًا؟")) return;
            setBusy(true);
            const res = await fetch(`/api/recipes/${r.id}`, {
              method: "DELETE",
              headers: { "x-edit-key": getEditKey() },
            });
            setBusy(false);
            if (res.ok) {
              toast("تم حذف الوصفة.", "success");
              router.push("/");
            } else toast("فشل الحذف.", "error");
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
                onClick={() => {
                  addToShopping(
                    r.id,
                    r.title || "وصفة",
                    ingredients.map((i) => scaleIngredient(i, scale))
                  );
                  setAdded(true);
                  setTimeout(() => setAdded(false), 1500);
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
                  const res = await fetch(`/api/recipes/${r.id}/retry`, {
                    method: "POST",
                    headers: { "x-edit-key": getEditKey() },
                  }).catch(() => null);
                  setBusy(false);
                  if (res?.ok) {
                    toast("بدأت إعادة الاستخراج في الخلفية.", "success");
                    setTimeout(() => router.refresh(), 12_000);
                  } else toast("تعذّرت إعادة المحاولة.", "error");
                }}
              >
                <Icon name="refresh" size={17} className={busy ? "spin" : ""} />{" "}
                {busy ? "جاري الإرسال..." : "إعادة الاستخراج"}
              </button>
            )}
            {hasSource && (
              <a className="btn-primary" href={r.source_url} target="_blank" rel="noopener noreferrer">
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
                  <button className="nutrition-complete" onClick={completeNutrition} disabled={busy}>
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
                <span className="progress">
                  {checked.length}/{ingredients.length}
                </span>
              </div>
              <div className="scaler no-print">
                <span className="scaler-label">الكمية:</span>
                {SCALE_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    className={`scale-btn ${scale === o.value ? "active" : ""}`}
                    onClick={() => setScale(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              {r.ingredient_sections && r.ingredient_sections.length ? (
                (() => {
                  let gi = -1;
                  return r.ingredient_sections.map((sec, si) => (
                    <div key={si} className="ing-group">
                      {sec.title && <h3 className="ing-section">{sec.title}</h3>}
                      <ul className="ingredients">
                        {sec.items.map((ing) => {
                          gi++;
                          const idx = gi;
                          return (
                            <li
                              key={idx}
                              className={checked.includes(idx) ? "done" : ""}
                              onClick={() => toggleCheck(idx)}
                            >
                              <span className="tick">{checked.includes(idx) ? "✓" : ""}</span>
                              {scaleIngredient(ing, scale)}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ));
                })()
              ) : (
                <ul className="ingredients">
                  {ingredients.map((ing, i) => (
                    <li
                      key={i}
                      className={checked.includes(i) ? "done" : ""}
                      onClick={() => toggleCheck(i)}
                    >
                      <span className="tick">{checked.includes(i) ? "✓" : ""}</span>
                      {scaleIngredient(ing, scale)}
                    </li>
                  ))}
                </ul>
              )}
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
            <div className="personal-row">
              <div className="stars" title="تقييم">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className="star-btn"
                    onClick={() => patch({ rating: r.rating === n ? null : n })}
                    aria-label={`${n} نجوم`}
                  >
                    {n <= (r.rating || 0) ? "★" : "☆"}
                  </button>
                ))}
              </div>
              <button
                className={`chip-toggle ${r.cooked ? "active" : ""}`}
                onClick={() => patch({ cooked: !r.cooked })}
              >
                <Icon name="check" size={16} /> {r.cooked ? "طبختها" : "علّمها كمطبوخة"}
              </button>
            </div>
            <textarea
              className="notes-area"
              placeholder="ملاحظاتي وتعديلاتي على الوصفة..."
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setNotesSaved(false);
              }}
              rows={3}
            />
            <button
              className="btn-ghost"
              onClick={async () => {
                if (await patch({ notes })) {
                  setNotesSaved(true);
                  toast("تم حفظ الملاحظة.", "success");
                }
              }}
            >
              {notesSaved ? "✓ حُفظت" : "حفظ الملاحظة"}
            </button>
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
                          alt={rec.title || ""}
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

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch(`/api/recipes/${r.id}/image`, {
            method: "POST",
            headers: { "x-edit-key": getEditKey() },
            body: fd,
          });
          setBusy(false);
          if (res.ok) {
            const { image_url } = await res.json();
            setR((cur) => ({ ...cur, image_url }));
            router.refresh();
            toast("تم تحديث الصورة.", "success");
          } else toast("فشل رفع الصورة.", "error");
        }}
      />
    </div>
  );
}

function EditForm({
  r,
  busy,
  onSave,
  onCancel,
  onDelete,
  onImage,
  onEstimateNutrition,
}: {
  r: Recipe;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
  onDelete: () => void;
  onImage: () => void;
  onEstimateNutrition: () => Promise<Nutrition | null>;
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

  const toNumber = (value: string) => (value.trim() === "" ? null : Number(value));
  const save = () => {
    const nutrition = {
      calories: toNumber(calories),
      protein_g: toNumber(protein),
      carbs_g: toNumber(carbs),
      fat_g: toNumber(fat),
    };
    onSave({
      title,
      author,
      servings,
      time_minutes: time ? Number(time) : null,
      tags: tags.split(/[،,\n]/).map((s) => s.trim()).filter(Boolean),
      collections: collections.split(/[،,\n]/).map((s) => s.trim()).filter(Boolean),
      ingredients: ingredients.split("\n").map((s) => s.trim()).filter(Boolean),
      steps: steps.split("\n").map((s) => s.trim()).filter(Boolean),
      nutrition: Object.values(nutrition).every((value) => value == null) ? null : nutrition,
      status: "ok",
    });
  };

  const estimateNutrition = async () => {
    const nutrition = await onEstimateNutrition();
    if (!nutrition) return;
    setCalories(nutrition.calories?.toString() || "");
    setProtein(nutrition.protein_g?.toString() || "");
    setCarbs(nutrition.carbs_g?.toString() || "");
    setFat(nutrition.fat_g?.toString() || "");
  };

  return (
    <div className="edit-form">
      <div className="edit-photo">
        <div className="edit-photo-preview">
          {r.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.image_url} alt={`صورة ${r.title || "الوصفة"}`} className="recipe-hero" />
          ) : (
            <div className="recipe-hero placeholder-hero">🍲</div>
          )}
        </div>
        <button type="button" className="photo-change-button" onClick={onImage} disabled={busy}>
          <span className="photo-change-icon"><Icon name="camera" size={20} /></span>
          <span>
            <strong>{r.image_url ? "استبدال صورة الوصفة" : "إضافة صورة للوصفة"}</strong>
            <small>اختر صورة JPG أو PNG أو WebP حتى 10 ميجابايت</small>
          </span>
        </button>
      </div>

      <label>العنوان</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} />

      <div className="edit-row">
        <div>
          <label>الطاهي / المصدر</label>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div>
          <label>الحصص</label>
          <input value={servings} onChange={(e) => setServings(e.target.value)} />
        </div>
        <div>
          <label>الوقت (دقيقة)</label>
          <input
            type="number"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      </div>

      <fieldset className="nutrition-editor">
        <div className="nutrition-editor-head">
          <div>
            <legend>القيم الغذائية</legend>
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

      <label>الوسوم (افصل بفاصلة)</label>
      <input value={tags} onChange={(e) => setTags(e.target.value)} />

      <label>المجموعات (عشاء، حلويات، رمضان...)</label>
      <input value={collections} onChange={(e) => setCollections(e.target.value)} />

      <label>المكونات (سطر لكل مكوّن)</label>
      <textarea
        rows={8}
        value={ingredients}
        onChange={(e) => setIngredients(e.target.value)}
      />

      <label>الخطوات (سطر لكل خطوة)</label>
      <textarea rows={10} value={steps} onChange={(e) => setSteps(e.target.value)} />

      <div className="edit-actions">
        <button className="btn-primary" onClick={save} disabled={busy}>
          <Icon name={busy ? "refresh" : "check"} size={17} className={busy ? "spin" : ""} />{" "}
          {busy ? "جاري الحفظ..." : "حفظ"}
        </button>
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>
          إلغاء
        </button>
        <button className="btn-danger" onClick={onDelete} disabled={busy}>
          <Icon name="trash" size={17} /> حذف الوصفة
        </button>
      </div>
    </div>
  );
}
