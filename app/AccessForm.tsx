"use client";

import { useState } from "react";
import { verifyEditKey } from "@/lib/client";

export function AccessForm({ onUnlocked }: { onUnlocked: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="menu-unlock" onSubmit={async (e) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true); setError("");
    try { await verifyEditKey(key.trim()); setKey(""); onUnlocked(); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذّر التحقق."); }
    finally { setBusy(false); }
  }}>
    <label htmlFor="access-key">مفتاح التحرير</label>
    <input id="access-key" type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="current-password" disabled={busy} />
    {error && <p role="alert" className="field-error">{error}</p>}
    <button className="btn-primary" disabled={busy || !key.trim()}>{busy ? "جاري التحقق..." : "تفعيل"}</button>
  </form>;
}
