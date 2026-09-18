import { getEditKey, setEditKey } from "./client";

export class RequestError extends Error {
  constructor(message: string, public status = 0, public data: any = null) { super(message); }
}

export function requestMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذّر إتمام الطلب. حاول مرة أخرى.";
}

export async function requestJson<T>(path: string, init: RequestInit = {}, timeout = 35000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const cancel = () => controller.abort();
  init.signal?.addEventListener("abort", cancel, { once: true });
  if (init.signal?.aborted) controller.abort();
  const key = getEditKey();
  try {
    const response = await fetch(path, { ...init, signal: controller.signal,
      headers: { "x-edit-key": key, ...init.headers } });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 && getEditKey() === key) setEditKey("");
      const message = response.status === 401 ? "مفتاح التحرير غير صحيح أو انتهت صلاحيته. فعّل التحرير من الإعدادات."
        : response.status === 413 || data?.error === "file too large" ? "الصورة كبيرة جدًا. اختر صورة أصغر من الحد الموضّح."
        : response.status === 415 ? "صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WebP."
        : response.status === 429 ? "طلبات كثيرة. انتظر قليلًا ثم حاول مرة أخرى."
        : response.status === 400 ? "تحقق من البيانات المدخلة ثم حاول مرة أخرى."
        : "تعذّر إتمام الطلب الآن. احتفظنا بمدخلاتك؛ حاول مرة أخرى.";
      throw new RequestError(message, response.status, data);
    }
    if (data == null) throw new RequestError("وصل رد غير صالح. حاول مرة أخرى.");
    return data as T;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (controller.signal.aborted) throw new RequestError("توقف الانتظار. قد يستمر الحفظ؛ تحقق من المعرض قبل إعادة المحاولة.");
    throw new RequestError("تعذّر الاتصال. تحقق من الشبكة وحاول مرة أخرى.");
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
  }
}

export const jsonBody = (body: unknown): RequestInit => ({
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

export function validateImage(file: File, maxMB: number) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("اختر صورة JPG أو PNG أو WebP.");
  if (!file.size || file.size > maxMB * 1024 * 1024) throw new Error(`اختر صورة بحجم أقل من ${maxMB} ميجابايت.`);
}
