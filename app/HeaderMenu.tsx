"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AccessForm } from "./AccessForm";
import { Icon } from "./Icon";
import { toast } from "./Toast";
import { getEditKey, setEditKey, hasEditKey, verifyEditKey, invalidateAccess } from "@/lib/client";

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

  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  useEffect(() => {
    setUnlocked(hasEditKey());
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, [open]);

  useEffect(() => {
    const sync = () => setUnlocked(hasEditKey());
    const verify = () => { const key = getEditKey(); if (key && !hasEditKey()) verifyEditKey(key).catch(() => {}); sync(); };
    const storage = (e: StorageEvent) => { if (e.key === "recipebox_edit_key" || e.key === null) { invalidateAccess(); verify(); } };
    const show = () => { setOpen(true); setTimeout(() => document.getElementById("access-key")?.focus(), 0); };
    verify();
    window.addEventListener("editkey-changed", sync);
    window.addEventListener("storage", storage);
    window.addEventListener("edit-requested", show);
    return () => { window.removeEventListener("editkey-changed", sync); window.removeEventListener("storage", storage); window.removeEventListener("edit-requested", show); };
  }, []);

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

  return (
    <div className="menu-wrap" ref={wrapRef} onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-controls="preferences-panel"
        className={`icon-btn ${open ? "on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="الإعدادات"
        title="الإعدادات"
      >
        <Icon name="menu" />
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu-panel" id="preferences-panel" aria-label="الإعدادات">
            <div className="menu-head">الإعدادات</div>
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
              <AccessForm onUnlocked={() => { setUnlocked(true); setOpen(false); toast("تم تفعيل وضع التحرير.", "success"); }} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
