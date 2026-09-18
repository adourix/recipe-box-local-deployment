"use client";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";

export function ImportProgress({ file, onCancel }: { file: File | null; onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [preview, setPreview] = useState("");
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <div className="import-progress" aria-busy="true">
    {preview && <img className="import-preview" src={preview} alt="الصورة المختارة للاستيراد" />}
    <div className="import-progress-content">
      <strong role="status"><Icon name="refresh" size={20} className="spin import-spin" />{stopping ? "جاري إيقاف الانتظار…" : file ? "جاري إرسال الصورة واستخراج الوصفة…" : "جاري استخراج الوصفة من الرابط…"}</strong>
      {file && <div className="import-filename" dir="auto">{file.name}</div>}
      <p>{elapsed >= 45 ? "ما زلنا ننتظر رد الخدمة. الصور الكبيرة والوصفات الطويلة قد تستغرق وقتًا أطول." : "سنفتح الوصفة تلقائيًا عند اكتمال الحفظ. قد تستغرق العملية حتى خمس دقائق."}</p>
      <div className="import-progress-footer"><span>الوقت المنقضي: <bdi>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</bdi></span>
      <button className="btn-ghost" disabled={stopping} onClick={() => { setStopping(true); onCancel(); }}>إيقاف الانتظار</button></div>
      <small>إيقاف الانتظار لا يلغي حفظًا بدأ على الخادم؛ تحقق من المعرض قبل إعادة المحاولة.</small>
    </div>
  </div>;
}
