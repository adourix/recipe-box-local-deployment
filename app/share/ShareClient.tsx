"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getEditKey, hasEditKey, verifyEditKey } from "@/lib/client";
import { requestJson, jsonBody, requestMessage, RequestError } from "@/lib/request";
import { AccessForm } from "@/app/AccessForm";

type State = "idle" | "saving" | "done" | "duplicate" | "error" | "nokey" | "nourl";
export default function ShareClient({shared}: {shared: string}) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = async () => {
    if (controller.current) return;
    if (!shared.trim()) { setState("nourl"); return; }
    if (!getEditKey()) { setState("nokey"); return; }
    setState("saving"); setMessage("");
    const current = generation.current;
    const pending = new AbortController(); controller.current = pending;
    try {
      if (!hasEditKey()) await verifyEditKey(getEditKey());
      if (current !== generation.current) return;
      const result = await requestJson<{id: string; title?: string}>("/api/web-save", {...jsonBody({url: shared}), signal: pending.signal}, 310000);
      if (current !== generation.current) return;
      if (!result.id) throw new Error("وصل رد غير صالح. تحقق من المعرض قبل إعادة المحاولة.");
      setState("done"); setMessage(result.title || "");
      timer.current = setTimeout(() => router.replace(`/recipe/${result.id}`), 900);
    } catch(e) {
      if (current !== generation.current) return;
      if (pending.signal.aborted) { setState("error"); setMessage("توقف الانتظار. قد يستمر الحفظ؛ تحقق من المعرض قبل إعادة المحاولة."); }
      else if (e instanceof RequestError && e.status === 409 && e.data?.id) {
        setState("duplicate"); setMessage("الوصفة موجودة بالفعل. جارٍ فتحها...");
        timer.current = setTimeout(() => router.replace(`/recipe/${e.data.id}`), 900);
      } else { setState(hasEditKey() ? "error" : "nokey"); setMessage(requestMessage(e)); }
    } finally { if (controller.current === pending) controller.current = null; }
  };
  useEffect(() => {
    run();
    return () => { generation.current++; controller.current?.abort(); controller.current = null; if (timer.current) clearTimeout(timer.current); };
    // Start a new import only when the shared content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);
  const heading = state === "saving" ? "جاري حفظ الوصفة..." : state === "done" ? "تم الحفظ" : state === "duplicate" ? "الوصفة محفوظة مسبقًا" : state === "nokey" ? "فعّل وضع التحرير" : state === "nourl" ? "لم أجد رابطًا في المشاركة" : state === "error" ? "تعذّر الحفظ" : "تحضير المشاركة";
  return <main id="main-content" className="container share-page"><div className="share-card">
    <div className="share-logo" aria-hidden="true">🍽️</div>
    <h1>{heading}</h1>
    <div role="status">{message}</div>
    {state === "saving" && <><div className="spinner" aria-hidden="true" /><p className="muted">قد يستغرق استخراج الوصفة حتى خمس دقائق.</p><button className="btn-ghost" onClick={() => controller.current?.abort()}>إيقاف الانتظار</button></>}
    {state === "nokey" && <AccessForm onUnlocked={run} />}
    {state === "error" && <button className="btn-primary" onClick={run}>إعادة المحاولة</button>}
    <Link className="btn-ghost" href="/">العودة إلى الوصفات</Link>
  </div></main>;
}
