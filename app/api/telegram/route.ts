import { NextRequest, NextResponse } from "next/server";
import { runInBackground } from "@/lib/background";
import { extractUrls, processVideo, processPhoto, searchRecipes } from "@/lib/pipeline";
import { sendMessage, escapeHtml } from "@/lib/telegram";
import { enqueueJob, triggerWorker, queueStatus } from "@/lib/queue";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // 1) Verify the secret header Telegram echoes back from setWebhook.
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  // Fail closed: reject if the secret isn't configured or doesn't match.
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message ?? update?.channel_post;
  const chatId: number | undefined = msg?.chat?.id;
  const fromId = msg?.from?.id;
  const text: string = (msg?.text ?? msg?.caption ?? "").trim();

  if (!chatId) return NextResponse.json({ ok: true });

  // 2) Restrict to the owner (once ALLOWED_TELEGRAM_USER_ID is set).
  const allowed = process.env.ALLOWED_TELEGRAM_USER_ID;
  if (allowed && String(fromId) !== String(allowed)) {
    await sendMessage(chatId, "عذرًا، هذا البوت خاص. 🔒");
    return NextResponse.json({ ok: true });
  }

  // 3) Commands / help.
  if (text.startsWith("/start") || text.startsWith("/help")) {
    await sendMessage(
      chatId,
      `أهلاً بك في <b>كتاب وصفات أمير</b> 🍽️\n\n` +
        `• أرسل <b>رابط</b> وصفة من انستغرام أو فيسبوك أو تيك توك — أحفظها مع الصورة والمكونات والخطوات.\n` +
        `• إذا كانت الوصفة مشروحة داخل الفيديو فقط، أرسل <b>الفيديو نفسه</b> وسأستمع إليه وأستخرج الوصفة.\n\n` +
        `معرفك في تيليجرام: <code>${fromId}</code>`
    );
    return NextResponse.json({ ok: true });
  }

  if (text === "/queue" || text === "/status" || text === "الطابور") {
    const s = await queueStatus();
    if (s.pending || s.processing) {
      await sendMessage(
        chatId,
        `📊 الطابور:\n• قيد الانتظار: ${s.pending}\n• قيد المعالجة: ${s.processing}\n\n⏳ سأحرّك المعالجة الآن...`
      );
      runInBackground(triggerWorker());
    } else {
      await sendMessage(chatId, "✅ الطابور فارغ — كل الوصفات تمت معالجتها.");
    }
    return NextResponse.json({ ok: true });
  }

  // 4a) Photo / screenshot sent -> OCR the recipe.
  const photo = Array.isArray(msg?.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
  const photoDoc =
    msg?.document && /^image\//.test(msg.document.mime_type || "") ? msg.document : null;
  const img = photo || photoDoc;
  if (img?.file_id) {
    await sendMessage(chatId, "⏳ جاري قراءة الوصفة من الصورة...");
    runInBackground(
      processPhoto({ fileId: img.file_id, chatId, caption: msg?.caption }).catch(async (e) => {
        console.error("processPhoto failed", e);
        await sendMessage(chatId, "⚠️ حدث خطأ أثناء قراءة الصورة.");
      })
    );
    return NextResponse.json({ ok: true });
  }

  // 4b) Video sent directly (reel whose recipe is only spoken) -> transcribe.
  const video =
    msg?.video ||
    (msg?.document && /^video\//.test(msg.document.mime_type || "")
      ? msg.document
      : null) ||
    msg?.animation;
  if (video?.file_id) {
    const thumbFileId =
      msg?.video?.thumbnail?.file_id ||
      msg?.video?.thumb?.file_id ||
      video?.thumbnail?.file_id ||
      video?.thumb?.file_id;
    await sendMessage(
      chatId,
      "⏳ جاري تحليل الفيديو واستخراج الوصفة... قد يستغرق حتى دقيقة."
    );
    runInBackground(
      processVideo({
        fileId: video.file_id,
        thumbFileId,
        mimeType: video.mime_type,
        chatId,
        caption: msg?.caption,
        sizeHint: video.file_size,
      }).catch(async (e) => {
        console.error("processVideo failed", e);
        await sendMessage(chatId, "⚠️ حدث خطأ غير متوقع أثناء تحليل الفيديو.");
      })
    );
    return NextResponse.json({ ok: true });
  }

  // Desktop shares put the URL in a `text_link` entity, not the visible text —
  // collect from both plain text and link entities.
  const entities = (msg?.entities || msg?.caption_entities || []) as Array<{
    type: string;
    url?: string;
  }>;
  const entityUrls = entities
    .filter((e) => e.type === "text_link" && e.url)
    .map((e) => (e.url as string).replace(/[)\].,]+$/, ""));
  const urls = [...new Set([...extractUrls(text), ...entityUrls])];
  if (!urls.length) {
    // No link → treat the message as a search query over saved recipes.
    const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
    const results = await searchRecipes(text);
    if (!results.length) {
      await sendMessage(
        chatId,
        "لم أجد وصفات مطابقة. جرّب كلمة أخرى، أو أرسل رابط/صورة وصفة لحفظها."
      );
      return NextResponse.json({ ok: true });
    }
    const lines = results
      .map((r) => `• <b>${escapeHtml(r.title)}</b>\n${base}/recipe/${r.id}`)
      .join("\n\n");
    await sendMessage(chatId, `🔎 نتائج البحث:\n\n${lines}`);
    return NextResponse.json({ ok: true });
  }

  // 4) Enqueue every link and kick the worker. The queue serialises Gemini
  //    calls, so sending many links at once never trips the rate limit.
  for (const u of urls) await enqueueJob(u, chatId);
  await sendMessage(
    chatId,
    urls.length === 1
      ? "⏳ جاري حفظ الوصفة..."
      : `⏳ أضفت ${urls.length} روابط للطابور، سأرسل كل وصفة عند جهوزها.`
  );
  runInBackground(triggerWorker());

  return NextResponse.json({ ok: true });
}
