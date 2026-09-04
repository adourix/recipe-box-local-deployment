import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { enqueueJob, triggerWorker } from "@/lib/queue";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const key = process.env.EDIT_KEY;
  return Boolean(key) && req.headers.get("x-edit-key") === key;
}

type RetryState = "idle" | "queued" | "processing" | "success" | "review" | "failed";

function retryPayload(
  recipe: { status: string; platform: string | null },
  job?: { id: string; status: string; error: string | null; attempts: number; created_at: string }
) {
  let state: RetryState = "idle";
  let title = "لا توجد محاولة نشطة";
  let detail = "اضغط إعادة الاستخراج لبدء محاولة جديدة.";

  if (recipe.status === "ok") {
    state = "success";
    title = "تم تحديث الوصفة";
    detail = "اكتمل استخراج الاسم والمكونات والخطوات.";
  } else if (job?.status === "pending") {
    state = "queued";
    title = "المحاولة في الانتظار";
    detail = "تم حفظ الطلب وسيبدأ تلقائيًا فور انتهاء المهمة التي قبله.";
  } else if (job?.status === "processing") {
    state = "processing";
    title = "جاري استخراج الوصفة";
    detail = "نفتح الرابط، ونقرأ النص والصوت، ثم نحدّث الاسم والمكونات والخطوات.";
  } else if (job?.status === "error") {
    state = "failed";
    title = "توقفت المحاولة بسبب خطأ";
    detail = /timeout|timed out/i.test(job.error || "")
      ? "استغرق المصدر وقتًا أطول من المسموح. يمكنك المحاولة مرة أخرى."
      : "حدث خطأ أثناء المعالجة. يمكنك المحاولة مرة أخرى، وستبدأ كمهمة جديدة.";
  } else if (job?.status === "done" && recipe.status === "needs_review") {
    state = "review";
    title = "وصلنا للمصدر لكن الوصفة غير مكتملة";
    detail = "لم نجد مكونات أو خطوات كافية بثقة. افتح المصدر أو أضف البيانات يدويًا.";
  } else if (job?.status === "done" && recipe.status === "fetch_failed") {
    state = "failed";
    title = "تعذّر فتح محتوى المصدر";
    detail =
      recipe.platform === "facebook"
        ? "فيسبوك يطلب تسجيل دخول أو صلاحية مشاهدة لهذا الفيديو. الرابط ما زال محفوظًا ويمكنك المحاولة لاحقًا."
        : "المصدر لم يرسل صورة أو نصًا أو فيديو يمكن قراءته. قد يكون خاصًا أو محذوفًا.";
  }

  return {
    state,
    title,
    detail,
    jobId: job?.id || null,
    createdAt: job?.created_at || null,
    attempts: job?.attempts || 0,
  };
}

async function recipeAndLatestJob(id: string) {
  const sb = supabaseAdmin();
  const { data: recipe, error } = await sb
    .from("recipes")
    .select("source_url,status,platform")
    .eq("id", id)
    .single();
  if (error || !recipe) return null;
  const { data: jobs } = await sb
    .from("jobs")
    .select("id,status,error,attempts,created_at")
    .eq("url", recipe.source_url)
    .order("created_at", { ascending: false })
    .limit(1);
  return { recipe, job: jobs?.[0] };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const result = await recipeAndLatestJob(id);
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(retryPayload(result.recipe, result.job));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("recipes")
    .select("source_url,status,platform")
    .eq("id", id)
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (data.status === "ok") {
    return NextResponse.json({ ok: true, already_complete: true });
  }
  if (!data.source_url || !/^https?:\/\//.test(data.source_url)) {
    return NextResponse.json({ error: "no source" }, { status: 400 });
  }

  const { data: active } = await sb
    .from("jobs")
    .select("id,status,error,attempts,created_at")
    .eq("url", data.source_url)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (active?.[0]) {
    return NextResponse.json({
      ok: true,
      queued: true,
      retry: retryPayload(data, active[0]),
    });
  }

  const job = await enqueueJob(data.source_url, null);
  await triggerWorker();
  return NextResponse.json({
    ok: true,
    queued: true,
    retry: retryPayload(data, { ...job, error: null, attempts: 0 }),
  }, { status: 202 });
}
