"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { toast } from "./Toast";
import { getEditKey, setEditKey } from "@/lib/client";

export interface MenuAction {
  icon: string;
  label: string;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}

export function HeaderMenu({ actions = [] }: { actions?: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [dark, setDark] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    setUnlocked(getEditKey().length > 0);
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, [open]);

  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {}
    setDark(!dark);
  };

  const run = (fn?: () => void) => {
    setOpen(false);
    fn?.();
  };

  const admin = async (path: string, label: string, done: (j: any) => string) => {
    setBusy(label);
    toast(`جاري ${label}...`);
    const res = await fetch(path, {
      method: "POST",
      headers: { "x-edit-key": getEditKey() },
    }).catch(() => null);
    setBusy("");
    if (res && res.ok) toast(done(await res.json()), "success");
    else toast(`تعذّر ${label}.`, "info");
  };

  return (
    <div className="menu-wrap">
      <button
        className={`icon-btn ${open ? "on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="القائمة"
        title="القائمة"
      >
        <Icon name="menu" />
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu-panel" role="menu">
            {actions.map((a, i) =>
              a.href ? (
                <Link key={i} href={a.href} className="menu-item" onClick={() => setOpen(false)}>
                  <Icon name={a.icon} size={18} /> {a.label}
                </Link>
              ) : (
                <button
                  key={i}
                  className={`menu-item ${a.danger ? "danger" : ""}`}
                  onClick={() => run(a.onClick)}
                >
                  <Icon name={a.icon} size={18} /> {a.label}
                </button>
              )
            )}

            <div className="menu-div" />
            <button className="menu-item" onClick={toggleTheme}>
              <Icon name={dark ? "sun" : "moon"} size={18} />{" "}
              {dark ? "الوضع النهاري" : "الوضع الليلي"}
            </button>

            <div className="menu-div" />
            {unlocked ? (
              <>
                <div className="menu-head">
                  <Icon name="unlock" size={16} /> وضع التحرير مفعّل
                </div>
                <button
                  className="menu-item"
                  disabled={!!busy}
                  onClick={() =>
                    admin(
                      "/api/retag",
                      "تحديث التصنيفات",
                      (j) => `تم تحديث تصنيفات ${j.recipesChanged} وصفة (${j.tagsBefore}→${j.tagsAfter} وسم).`
                    )
                  }
                >
                  <Icon name="refresh" size={18} className={busy === "تحديث التصنيفات" ? "spin" : ""} />{" "}
                  {busy === "تحديث التصنيفات" ? "جاري تحديث التصنيفات..." : "تحديث تصنيفات الوصفات"}
                </button>
                <button
                  className="menu-item"
                  disabled={!!busy}
                  onClick={() =>
                    admin("/api/sections", "تقسيم المكونات", (j) => `تم تقسيم ${j.updated} وصفة.`)
                  }
                >
                  <Icon name="utensils" size={18} className={busy === "تقسيم المكونات" ? "spin" : ""} />{" "}
                  {busy === "تقسيم المكونات" ? "جاري تقسيم المكونات..." : "تقسيم المكونات"}
                </button>
                <button
                  className="menu-item danger"
                  onClick={() => {
                    setEditKey("");
                    setUnlocked(false);
                    setOpen(false);
                    toast("تم إيقاف وضع التحرير.");
                  }}
                >
                  <Icon name="lock" size={18} /> إيقاف التحرير
                </button>
              </>
            ) : (
              <div className="menu-unlock">
                <div className="menu-head">
                  <Icon name="lock" size={16} /> وضع التحرير
                </div>
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="مفتاح التحرير"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && keyInput.trim()) {
                      setEditKey(keyInput.trim());
                      setUnlocked(true);
                      setKeyInput("");
                      toast("تم تفعيل وضع التحرير.", "success");
                    }
                  }}
                />
                <button
                  className="btn-primary"
                  onClick={() => {
                    if (!keyInput.trim()) return;
                    setEditKey(keyInput.trim());
                    setUnlocked(true);
                    setKeyInput("");
                    toast("تم تفعيل وضع التحرير.", "success");
                  }}
                >
                  تفعيل
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
