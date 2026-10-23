"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import type { Recipe } from "@/lib/types";
import { ImportProgress } from "./ImportProgress";
import { CartLink } from "./CartLink";
import { HeaderMenu } from "./HeaderMenu";
import { Icon } from "./Icon";
import { getEditKey, hasEditKey, requestUnlock } from "@/lib/client";
import { arabicNormalize } from "@/lib/arabic";
import { isDuplicateRecipe } from "@/lib/dedupe";
import { requestJson, jsonBody, requestMessage, RequestError, validateImage } from "@/lib/request";
import { toast } from "./Toast";
import { TAG_GROUPS, canonicalizeTag, tagGroupId } from "@/lib/tags";

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "انستغرام", facebook: "فيسبوك", tiktok: "تيك توك",
  youtube: "يوتيوب", video: "فيديو", photo: "صورة", other: "أخرى",
};

type Sort = "newest" | "oldest" | "fastest" | "az";
const PAGE_SIZE = 24;

export default function GalleryClient({
  recipes,
  initialQuery = "",
  initialTag = "",
  initialCollection = "",
}: {
  recipes: Recipe[];
  initialQuery?: string;
  initialTag?: string;
  initialCollection?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") || initialQuery);
  const [tags, setTags] = useState<string[]>(params.getAll("tag").length ? params.getAll("tag") : initialTag ? [initialTag] : []);
  const [platform, setPlatform] = useState(params.get("platform") || "");
  const [status, setStatus] = useState(params.get("status") || "");
  const [collection, setCollection] = useState(params.get("collection") || initialCollection);
  const [onlyFav, setOnlyFav] = useState(params.get("favorite") === "1");
  const [onlyCooked, setOnlyCooked] = useState(params.get("cooked") === "1");
  const [sort, setSort] = useState<Sort>((["newest", "oldest", "fastest", "az"].includes(params.get("sort") || "") ? params.get("sort") : "newest") as Sort);
  const [showAllTags, setShowAllTags] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [canEdit, setCanEdit] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [importError, setImportError] = useState("");
  const importController = useRef<AbortController | null>(null);
  useEffect(() => () => importController.current?.abort(), []);
  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set("q", q); tags.forEach(tag => next.append("tag", tag));
    if (platform) next.set("platform", platform); if (status) next.set("status", status);
    if (collection) next.set("collection", collection); if (onlyFav) next.set("favorite", "1");
    if (onlyCooked) next.set("cooked", "1"); if (sort !== "newest") next.set("sort", sort);
    const url = next.size ? `/?${next}` : "/";
    if (window.location.pathname === "/" && window.location.pathname + window.location.search !== url) window.history.replaceState(window.history.state, "", url);
  }, [q, tags, platform, status, collection, onlyFav, onlyCooked, sort]);
  useEffect(() => {
    const restore = () => { const p = new URLSearchParams(window.location.search);
      setQ(p.get("q") || ""); setTags(p.getAll("tag")); setPlatform(p.get("platform") || ""); setStatus(p.get("status") || "");
      setCollection(p.get("collection") || ""); setOnlyFav(p.get("favorite") === "1"); setOnlyCooked(p.get("cooked") === "1");
      setSort((["newest", "oldest", "fastest", "az"].includes(p.get("sort") || "") ? p.get("sort") : "newest") as Sort);
    };
    window.addEventListener("popstate", restore); return () => window.removeEventListener("popstate", restore);
  }, []);
  const photoRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLDialogElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (!filtersOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [filtersOpen]);

  const addByLink = async () => {
    if (adding || working) return;
    const url = addUrl.trim();
    try { if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error(); }
    catch { setImportError("أدخل رابطًا صحيحًا يبدأ بـ https://"); return; }
    if (!hasEditKey()) { requestUnlock(); return; }
    setImportFile(null); setAdding(true); setImportError(""); importController.current = new AbortController();
    try {
      const result = await requestJson<{id: string}>("/api/web-save", {...jsonBody({url}), signal: importController.current.signal}, 310000);
      if (!result.id) throw new Error("وصل رد غير صالح. تحقق من المعرض قبل إعادة المحاولة.");
      setAddUrl(""); setAddOpen(false); router.push(`/recipe/${result.id}`);
    } catch(e) {
      if (e instanceof RequestError && e.status === 409 && e.data?.id) { toast("الوصفة محفوظة مسبقًا.", "success"); router.push(`/recipe/${e.data.id}`); }
      else setImportError(requestMessage(e));
    } finally { setAdding(false); importController.current = null; }
  };

  useEffect(() => {
    const sync = () => setCanEdit(hasEditKey());
    sync();
    window.addEventListener("editkey-changed", sync);
    return () => window.removeEventListener("editkey-changed", sync);
  }, []);

  const deleteRecipe = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("حذف هذه الوصفة نهائيًا؟")) return;
    const res = await fetch(`/api/recipes/${id}`, {
      method: "DELETE",
      headers: { "x-edit-key": getEditKey() },
    }).catch(() => null);
    if (res && res.ok) {
      toast("تم حذف الوصفة.", "success");
      router.refresh();
    } else toast("فشل الحذف.", "error");
  };

  const collections = useMemo(() => {
    const s = new Set<string>();
    for (const r of recipes) for (const c of r.collections || []) s.add(c);
    return [...s].sort((a, b) => a.localeCompare(b, "ar"));
  }, [recipes]);

  const tagCounts = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of recipes) for (const t of r.tags || []) count.set(t, (count.get(t) || 0) + 1);
    return count;
  }, [recipes]);

  const allTags = useMemo(
    () => [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag),
    [tagCounts]
  );

  const groupedTags = useMemo(
    () =>
      TAG_GROUPS.map((group) => ({
        ...group,
        tags: group.tags.filter((tag) => tagCounts.has(tag)),
      })).filter((group) => group.tags.length),
    [tagCounts]
  );

  const otherTags = useMemo(() => allTags.filter((tag) => !tagGroupId(tag)), [allTags]);

  const platforms = useMemo(
    () => [...new Set(recipes.map((r) => r.platform).filter(Boolean))] as string[],
    [recipes]
  );

  // Match the save-time check, including its same-chef requirement.
  const duplicateRecipeIds = useMemo(() => {
    const ids = new Set<string>();
    for (let i = 0; i < recipes.length; i++) {
      for (let j = i + 1; j < recipes.length; j++) {
        if (isDuplicateRecipe(recipes[i], recipes[j])) {
          ids.add(recipes[i].id);
          ids.add(recipes[j].id);
        }
      }
    }
    return ids;
  }, [recipes]);

  const filtered = useMemo(() => {
    const needle = arabicNormalize(q);
    let list = recipes.filter((r) => {
      if (onlyFav && !r.favorite) return false;
      if (onlyCooked && !r.cooked) return false;
      if (collection && !(r.collections || []).includes(collection)) return false;
      if (platform && r.platform !== platform) return false;
      if (status && r.status !== status) return false;
      if (tags.length && !tags.every((t) => (r.tags || []).includes(t))) return false;
      if (needle) {
        const hay = arabicNormalize(
          [r.title, r.caption, r.author, ...(r.tags || []), ...(r.ingredients || [])]
            .filter(Boolean)
            .join(" ")
        );
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "oldest") return a.created_at.localeCompare(b.created_at);
      if (sort === "az") return (a.title || "").localeCompare(b.title || "", "ar");
      if (sort === "fastest") return (a.time_minutes ?? Infinity) - (b.time_minutes ?? Infinity);
      return b.created_at.localeCompare(a.created_at);
    });
    return list;
  }, [recipes, q, tags, platform, status, sort, onlyFav, onlyCooked, collection]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [recipes, q, tags, platform, status, sort, onlyFav, onlyCooked, collection]);

  const visibleRecipes = filtered.slice(0, visibleCount);

  const toggleTag = (tag: string) =>
    setTags((current) => {
      if (current.includes(tag)) return current.filter((item) => item !== tag);
      const group = tagGroupId(tag);
      return group
        ? [...current.filter((item) => tagGroupId(item) !== group), tag]
        : [...current, tag];
    });

  const activeFilters =
    tags.length + (platform ? 1 : 0) + (status ? 1 : 0) + (q.trim() ? 1 : 0) +
    (onlyFav ? 1 : 0) + (onlyCooked ? 1 : 0) + (collection ? 1 : 0);
  const clearAll = () => {
    setQ(""); setTags([]); setPlatform(""); setStatus(""); setCollection("");
    setOnlyFav(false); setOnlyCooked(false);
  };

  const surprise = () => {
    const pool = filtered.length ? filtered : recipes;
    if (!pool.length) return;
    router.push(`/recipe/${pool[Math.floor((Date.now() / 7) % pool.length)].id}`);
  };

  const onPhoto = async (file: File) => {
    if (adding || working) return;
    if (!hasEditKey()) { requestUnlock(); return; }
    try { validateImage(file, 12); } catch(e) { setImportError(requestMessage(e)); return; }
    setImportFile(file); setWorking("جاري قراءة الصورة واستخراج الوصفة..."); setImportError("");
    importController.current = new AbortController();
    const form = new FormData(); form.append("file", file);
    try {
      const result = await requestJson<{id: string}>("/api/photo-save", {method: "POST", body: form, signal: importController.current.signal}, 310000);
      if (!result.id) throw new Error("وصل رد غير صالح. تحقق من المعرض قبل إعادة المحاولة.");
      router.push(`/recipe/${result.id}`);
    } catch(e) {
      if (e instanceof RequestError && e.status === 409 && e.data?.id) { toast("الوصفة محفوظة مسبقًا.", "success"); router.push(`/recipe/${e.data.id}`); }
      else setImportError(requestMessage(e));
    } finally { setWorking(null); importController.current = null; }
  };

  const exportBackup = async () => {
    if (!hasEditKey()) { requestUnlock(); return; }
    try {
      const data = await requestJson<Recipe[]>("/api/export");
      if (!Array.isArray(data)) throw new Error("تعذّر قراءة النسخة الاحتياطية.");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: "application/json"}));
      const a = document.createElement("a"); a.href = url; a.download = `recipes-backup-${data.length}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); toast("تم تنزيل النسخة الاحتياطية.", "success");
    } catch(e) { toast(requestMessage(e), "error"); }
  };

  const reviewCount = recipes.filter((r) => r.status === "needs_review").length;
  const visibleOtherTags = showAllTags ? otherTags : otherTags.slice(0, 10);

  return (
    <div className="container">
      <header className="topbar gallery-header">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="brand-logo" width={40} height={40} />
          <div>
            <h1>كتاب وصفات عياد</h1>
            <span className="count">{recipes.length} وصفة</span>
          </div>
        </div>
        <div className="header-actions">
          <button aria-expanded={addOpen} className="btn-primary add-btn" aria-label="إضافة وصفة" disabled={adding || !!working} onClick={() => setAddOpen((o) => !o)}>
            <Icon name="plus" size={18} /><span className="add-label"> إضافة</span>
          </button>
          <CartLink />
          <HeaderMenu
            actions={[
              { icon: "download", label: "نسخة احتياطية (تصدير)", onClick: exportBackup },
            ]}
          />
        </div>
        <input
          ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPhoto(f);
            e.target.value = "";
          }}
        />
      </header>

      <main id="main-content">

      {addOpen && (
        <section className="add-panel" aria-label="إضافة وصفة">
          <div className="section-head"><h2>أضف وصفة إلى كتابك</h2><button className="icon-btn" aria-label="إغلاق الإضافة" disabled={adding || !!working} onClick={() => setAddOpen(false)}><Icon name="x" size={18} /></button></div>
          <p className="helper-text">ألصق رابطًا أو اختر صورة JPG أو PNG أو WebP حتى 12 ميجابايت.</p>
          {importError && <p className="field-error" role="alert">{importError}</p>}
          {!canEdit && <p className="note">فعّل التحرير لحفظ الوصفات. <button className="link-btn" onClick={requestUnlock}>تفعيل التحرير</button></p>}
          <div className="add-bar">
          {adding || working ? (
            <ImportProgress file={importFile} onCancel={() => importController.current?.abort()} />
          ) : (
            <>
              <span className="add-icon"><Icon name="link" size={18} /></span>
              <input
                aria-label="رابط الوصفة"
                dir="ltr"
                type="url"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                placeholder="ألصق رابط وصفة (انستغرام / فيسبوك / يوتيوب / تيك توك)..."
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && addByLink()}
              />
              <button className="btn-primary" disabled={!canEdit || !addUrl.trim()} onClick={addByLink}>
                حفظ
              </button>
            </>
          )}
        </div>
          <button className="btn-ghost" disabled={!canEdit || adding || !!working} onClick={() => photoRef.current?.click()}><Icon name="camera" size={18} /> استيراد من صورة</button>
        </section>
      )}

      <div className="toolbar">
        <div className="search">
          <span className="search-icon"><Icon name="search" size={18} /></span>
          <input
            aria-label="البحث في الوصفات" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالاسم، الوسم، أو المكوّن..." autoComplete="off"
          />
          {q && (
            <button className="search-clear" onClick={() => setQ("")} aria-label="مسح">
              <Icon name="x" size={16} />
            </button>
          )}
        </div>

        <div className="quick-filters filters-row">
          <button className="chip-toggle" onClick={surprise} disabled={!recipes.length}>اختر لي وصفة</button>
          <button className={`chip-toggle ${activeFilters ? "active" : ""}`} aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={() => { filterRef.current?.showModal(); setFiltersOpen(true); }}>
            <Icon name="filter" size={16} /> تصفية {activeFilters > 0 ? `(${activeFilters})` : ""}
          </button>
          <button aria-pressed={onlyFav} className={`chip-toggle ${onlyFav ? "active" : ""}`} onClick={() => setOnlyFav((f) => !f)}>
            <Icon name={onlyFav ? "heartFilled" : "heart"} size={16} /> المفضلة
          </button>
          <select aria-label="ترتيب الوصفات" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="newest">الأحدث</option><option value="oldest">الأقدم</option>
            <option value="fastest">الأسرع</option><option value="az">أبجدي</option>
          </select>
        </div>
        {activeFilters > 0 && <div className="active-filter-summary">
          <span>{[...tags, onlyFav && "المفضلة", onlyCooked && "طبختها", collection, platform && PLATFORM_LABEL[platform], status && (status === "ok" ? "مكتملة" : "غير مكتملة")].filter(Boolean).join(" · ") || "نتائج البحث"}</span>
          <button className="link-btn" onClick={clearAll}>مسح الكل</button>
        </div>}
        <dialog className="filter-dialog" ref={filterRef} aria-labelledby="filters-title" onClose={() => setFiltersOpen(false)} onClick={(e) => { if (e.target === e.currentTarget) filterRef.current?.close(); }}>
          <div className="filter-dialog-content">
          <header className="filter-dialog-head"><div><h2 id="filters-title">تصفية الوصفات</h2><p>اختار تصنيفًا من كل مجموعة لتضييق النتائج</p></div><button className="icon-btn" aria-label="إغلاق التصفية" onClick={() => filterRef.current?.close()}><Icon name="x" /></button></header>
          <div className="filter-dialog-scroll">
          <div className="filters-row">
          <button aria-pressed={onlyCooked} className={`chip-toggle ${onlyCooked ? "active" : ""}`} onClick={() => setOnlyCooked((c) => !c)}>
            <Icon name="check" size={16} /> طبختها
          </button>
          {collections.length > 0 && (
            <select aria-label="تصفية حسب المجموعة" value={collection} onChange={(e) => setCollection(e.target.value)}>
              <option value="">كل المجموعات</option>
              {collections.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {platforms.length > 1 && (
            <select aria-label="تصفية حسب المصدر" value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="">كل المصادر</option>
              {platforms.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p] || p}</option>)}
            </select>
          )}
          <select aria-label="تصفية حسب الحالة" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">كل الحالات</option>
            <option value="ok">مكتملة</option>
            <option value="needs_review">بحاجة لمراجعة{reviewCount ? ` (${reviewCount})` : ""}</option>
            <option value="fetch_failed">تعذّر استخراجها</option>
          </select>
          {activeFilters > 0 && (
            <button className="chip-toggle clear" onClick={clearAll}>
              <Icon name="x" size={15} /> مسح ({activeFilters})
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="tag-groups" aria-label="تصنيفات الوصفات">
            {groupedTags.map((group) => (
              <div className="tag-group" key={group.id}>
                <span className="tag-group-label">{group.label}</span>
                <div className="tag-cloud">
                  {group.tags.map((tag) => (
                    <button
                      key={tag}
                      className={`tag-pill ${tags.includes(tag) ? "active" : ""}`}
                      onClick={() => toggleTag(tag)}
                      aria-pressed={tags.includes(tag)}
                    >
                      {tag} <small>{tagCounts.get(tag)}</small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {otherTags.length > 0 && (
              <div className="tag-group tag-group-other">
                <span className="tag-group-label">وسوم أخرى</span>
                <div className="tag-cloud">
                  {visibleOtherTags.map((tag) => (
                    <button
                      key={tag}
                      className={`tag-pill ${tags.includes(tag) ? "active" : ""}`}
                      onClick={() => toggleTag(tag)}
                      aria-pressed={tags.includes(tag)}
                    >
                      {tag} <small>{tagCounts.get(tag)}</small>
                    </button>
                  ))}
                  {otherTags.length > 10 && (
                    <button className="tag-pill more" onClick={() => setShowAllTags((show) => !show)}>
                      {showAllTags ? "عرض أقل" : `المزيد +${otherTags.length - 10}`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
          </div>
          <footer className="filter-dialog-footer"><button className="btn-primary" onClick={() => filterRef.current?.close()}>عرض {filtered.length} وصفة</button><button className="btn-ghost" onClick={clearAll}>إعادة ضبط</button></footer>
          </div>
        </dialog>
      </div>

      <div className="results-meta" role="status" aria-live="polite">{filtered.length} من {recipes.length} وصفة</div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="big"><Icon name="utensils" size={48} /></div>
          {recipes.length === 0 ? (
            <><h2>كتابك يبدأ بوصفة واحدة</h2><p>احفظ رابط وصفة أو استورد صورة لتجدها هنا.</p><button className="btn-primary" onClick={() => setAddOpen(true)}>إضافة أول وصفة</button></>
          ) : (
            <p>لا نتائج مطابقة. <button className="link-btn" onClick={clearAll}>مسح الفلاتر</button></p>
          )}
        </div>
      ) : (
        <>
          <div className="grid">
            {visibleRecipes.map((r, index) => {
              const title = r.title || "وصفة بدون عنوان";

              return (
                <article className="card" key={r.id}>
                  <Link href={`/recipe/${r.id}`} className="card-link">
                    <span className="sr-only">النتيجة رقم {index + 1}: </span>
                    <div className="card-thumb-wrap">
                      {r.image_url ? (
                        <Image
                          src={r.image_url}
                          alt=""
                          fill
                          sizes="(max-width:600px) 45vw, (max-width:900px) 30vw, 260px"

                          priority={index === 0}
                          fetchPriority={index === 0 ? "high" : "auto"}
                          className="card-thumb"
                          style={{ objectFit: "cover" }}
                        />
                      ) : (
                        <div className="card-thumb placeholder"><Icon name="hat" size={40} /></div>
                      )}
                      <div className="badges-top">
                        {r.status !== "ok" && <span className="review-badge">{r.status === "needs_review" ? "بحاجة لمراجعة" : "تعذّر الاستيراد"}</span>}
                        {r.cooked && <span className="cooked-badge"><Icon name="check" size={12} /> طبختها</span>}
                        {duplicateRecipeIds.has(r.id) && <span className="dup-badge">مكرر؟</span>}
                      </div>
                      {r.favorite && <span className="fav-badge"><Icon name="heartFilled" size={16} /></span>}
                    </div>
                    <div className="card-body">
                      <h2 className="card-title">{title}</h2>
                      {r.author && (
                        <span className="card-author">
                          <Icon name="user" size={13} /> {r.author}
                        </span>
                      )}
                      <div className="card-meta">
                        {r.rating ? <span className="chip star">★ {r.rating}</span> : null}
                        {r.time_minutes ? (
                          <span className="chip time"><Icon name="clock" size={13} /> {r.time_minutes} د</span>
                        ) : null}
                        {(r.tags || []).slice(0, 2).map((t) => <span className="chip" key={t}>{t}</span>)}
                      </div>
                    </div>
                  </Link>
                  {canEdit && (
                    <button className="card-del" onClick={(e) => deleteRecipe(e, r.id)} aria-label={`حذف ${title}`}>
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
          {visibleRecipes.length < filtered.length && (
            <div className="load-more">
              <button
                className="btn-ghost"
                onClick={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, filtered.length))}
              >
                عرض المزيد ({filtered.length - visibleRecipes.length})
              </button>
            </div>
          )}
        </>
      )}
      </main>
    </div>
  );
}
