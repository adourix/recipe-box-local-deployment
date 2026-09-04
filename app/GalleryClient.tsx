"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Recipe } from "@/lib/types";
import { CartLink } from "./CartLink";
import { HeaderMenu } from "./HeaderMenu";
import { Icon } from "./Icon";
import { getEditKey, hasEditKey } from "@/lib/client";
import { arabicNormalize } from "@/lib/arabic";
import { isDuplicateRecipe } from "@/lib/dedupe";
import { toast } from "./Toast";

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
  const [q, setQ] = useState(initialQuery);
  const [tags, setTags] = useState<string[]>(initialTag ? [initialTag] : []);
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [collection, setCollection] = useState(initialCollection);
  const [onlyFav, setOnlyFav] = useState(false);
  const [onlyCooked, setOnlyCooked] = useState(false);
  const [sort, setSort] = useState<Sort>("newest");
  const [showAllTags, setShowAllTags] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [canEdit, setCanEdit] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const addByLink = async () => {
    const url = addUrl.trim();
    if (!url) return;
    if (!hasEditKey()) {
      toast("فعّل وضع التحرير أولًا (زر القفل).", "error");
      return;
    }
    setAdding(true);
    toast("جاري حفظ الوصفة...");
    try {
      const res = await fetch("/api/web-save", {
        method: "POST",
        headers: { "content-type": "application/json", "x-edit-key": getEditKey() },
        body: JSON.stringify({ url }),
      });
      const result = await res.json().catch(() => null);
      if (res.ok) {
        setAddUrl("");
        setAddOpen(false);
        router.push(`/recipe/${result.id}`);
      } else if (res.status === 409 && result?.id) {
        setAddUrl("");
        setAddOpen(false);
        toast("هذه الوصفة محفوظة مسبقًا — لم تتم إضافة نسخة أخرى.", "success");
        router.push(`/recipe/${result.id}`);
      } else toast("تعذّر حفظ الرابط.", "error");
    } finally {
      setAdding(false);
    }
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

  const allTags = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of recipes) for (const t of r.tags || []) count.set(t, (count.get(t) || 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [recipes]);

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

  const toggleTag = (t: string) =>
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

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
    if (!hasEditKey()) {
      toast("فعّل وضع التحرير أولًا (زر القفل).", "error");
      return;
    }
    setWorking("جاري قراءة الصورة واستخراج الوصفة...");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/photo-save", {
      method: "POST", headers: { "x-edit-key": getEditKey() }, body: fd,
    }).catch(() => null);
    const result = res ? await res.json().catch(() => null) : null;
    if (res && res.ok) {
      router.push(`/recipe/${result.id}`);
    } else if (res?.status === 409 && result?.id) {
      setWorking(null);
      toast("هذه الوصفة محفوظة مسبقًا — لم تتم إضافة نسخة أخرى.", "success");
      router.push(`/recipe/${result.id}`);
    } else {
      setWorking(null);
      toast("تعذّرت قراءة الصورة.", "error");
    }
  };

  const exportBackup = async () => {
    if (!hasEditKey()) {
      toast("فعّل وضع التحرير أولًا (زر القفل).", "error");
      return;
    }
    const res = await fetch("/api/export", { headers: { "x-edit-key": getEditKey() } });
    if (!res.ok) {
      toast("تعذّر التصدير.", "error");
      return;
    }
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recipes-backup-${data.length || ""}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reviewCount = recipes.filter((r) => r.status === "needs_review").length;
  const visibleTags = showAllTags ? allTags : allTags.slice(0, 12);

  return (
    <div className="container">
      {working && (
        <div className="overlay">
          <div className="overlay-box">
            <Icon name="refresh" size={22} className="spin" />
            <span>{working}</span>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="brand-logo" width={40} height={40} />
          <div>
            <h1>كتاب وصفات أمير</h1>
            <span className="count">{recipes.length} وصفة</span>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn-primary add-btn" onClick={() => setAddOpen((o) => !o)}>
            <Icon name="plus" size={18} /> إضافة
          </button>
          <CartLink />
          <HeaderMenu
            actions={[
              { icon: "plus", label: "إضافة برابط", onClick: () => setAddOpen(true) },
              { icon: "camera", label: "إضافة من صورة", onClick: () => photoRef.current?.click() },
              { icon: "dice", label: "وصفة عشوائية", onClick: surprise },
              { icon: "download", label: "نسخة احتياطية (تصدير)", onClick: exportBackup },
            ]}
          />
        </div>
        <input
          ref={photoRef} type="file" accept="image/*" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPhoto(f);
            e.target.value = "";
          }}
        />
      </header>

      <main>
      {addOpen && (
        <div className="add-bar">
          {adding ? (
            <div className="add-loading">
              <Icon name="refresh" size={18} className="spin" />
              <span>جاري استخراج الوصفة... قد يستغرق حتى دقيقة</span>
            </div>
          ) : (
            <>
              <span className="add-icon"><Icon name="link" size={18} /></span>
              <input
                type="url"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                placeholder="ألصق رابط وصفة (انستغرام / فيسبوك / يوتيوب / تيك توك)..."
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && addByLink()}
              />
              <button className="btn-primary" onClick={addByLink}>
                حفظ
              </button>
            </>
          )}
        </div>
      )}

      <div className="toolbar">
        <div className="search">
          <span className="search-icon"><Icon name="search" size={18} /></span>
          <input
            type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالاسم، الوسم، أو المكوّن..." autoComplete="off"
          />
          {q && (
            <button className="search-clear" onClick={() => setQ("")} aria-label="مسح">
              <Icon name="x" size={16} />
            </button>
          )}
        </div>

        <div className="filters-row">
          <button className={`chip-toggle ${onlyFav ? "active" : ""}`} onClick={() => setOnlyFav((f) => !f)}>
            <Icon name={onlyFav ? "heartFilled" : "heart"} size={16} /> المفضلة
          </button>
          <button className={`chip-toggle ${onlyCooked ? "active" : ""}`} onClick={() => setOnlyCooked((c) => !c)}>
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
          <select aria-label="ترتيب الوصفات" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="newest">الأحدث</option>
            <option value="oldest">الأقدم</option>
            <option value="fastest">الأسرع تحضيرًا</option>
            <option value="az">أبجدي</option>
          </select>
          {activeFilters > 0 && (
            <button className="chip-toggle clear" onClick={clearAll}>
              <Icon name="x" size={15} /> مسح ({activeFilters})
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="tag-cloud">
            {visibleTags.map((t) => (
              <button key={t} className={`tag-pill ${tags.includes(t) ? "active" : ""}`} onClick={() => toggleTag(t)}>
                {t}
              </button>
            ))}
            {allTags.length > 12 && (
              <button className="tag-pill more" onClick={() => setShowAllTags((s) => !s)}>
                {showAllTags ? "أقل −" : `المزيد +${allTags.length - 12}`}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="results-meta">{filtered.length} من {recipes.length} وصفة</div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="big"><Icon name="utensils" size={48} /></div>
          {recipes.length === 0 ? (
            <p>لا توجد وصفات بعد. أرسل رابط وصفة إلى بوت تيليجرام لتظهر هنا.</p>
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
                          alt={title}
                          fill
                          sizes="(max-width:600px) 45vw, 230px"
                          quality={55}
                          priority={index === 0}
                          fetchPriority={index === 0 ? "high" : "auto"}
                          className="card-thumb"
                          style={{ objectFit: "cover" }}
                        />
                      ) : (
                        <div className="card-thumb placeholder"><Icon name="hat" size={40} /></div>
                      )}
                      <div className="badges-top">
                        {r.status === "needs_review" && <span className="review-badge">بحاجة لمراجعة</span>}
                        {r.status === "fetch_failed" && <span className="review-badge">تعذّر الاستخراج</span>}
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
