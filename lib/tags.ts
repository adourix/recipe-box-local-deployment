import { arabicNormalize } from "./arabic";

export const TAG_GROUPS = [
  {
    id: "dish",
    label: "نوع الطبق",
    tags: [
      "أطباق رئيسية",
      "فطور",
      "شوربات",
      "سلطات",
      "مقبلات",
      "سندويتشات",
      "معجنات",
      "مخبوزات",
      "حلويات",
      "مشروبات",
      "صلصات",
    ],
  },
  {
    id: "protein",
    label: "البروتين",
    tags: ["دجاج", "لحوم", "أسماك", "مأكولات بحرية", "بيض", "نباتي"],
  },
  {
    id: "cuisine",
    label: "المطبخ",
    tags: ["مصري", "شامي", "خليجي", "مغربي", "تركي", "إيطالي", "هندي", "آسيوي", "مكسيكي"],
  },
  {
    id: "style",
    label: "الطريقة والمناسبة",
    tags: ["سريع", "اقتصادي", "صحي", "عالي البروتين", "بدون فرن", "في الفرن", "مشوي", "مقلي", "قدر واحد"],
  },
] as const;

export const CANONICAL_TAGS = TAG_GROUPS.flatMap((group) => [...group.tags]);

const CANONICAL_BY_NORMALIZED = new Map(
  CANONICAL_TAGS.map((tag) => [arabicNormalize(tag), tag])
);

const ALIASES: Record<string, string> = {
  فراخ: "دجاج",
  فرخه: "دجاج",
  دجاجه: "دجاج",
  لحمه: "لحوم",
  لحم: "لحوم",
  "لحم بقري": "لحوم",
  "لحم ضاني": "لحوم",
  سمك: "أسماك",
  اسماك: "أسماك",
  بحريات: "مأكولات بحرية",
  "ماكولات بحريه": "مأكولات بحرية",
  حلي: "حلويات",
  حلوي: "حلويات",
  حلوى: "حلويات",
  تحليه: "حلويات",
  سلطه: "سلطات",
  شوربه: "شوربات",
  ساندوتشات: "سندويتشات",
  سندوتشات: "سندويتشات",
  مخبوزات: "مخبوزات",
  معجنات: "معجنات",
  مقبلات: "مقبلات",
  مصريه: "مصري",
  شاميه: "شامي",
  لبناني: "شامي",
  لبنانيه: "شامي",
  سوري: "شامي",
  سوريه: "شامي",
  فلسطيني: "شامي",
  اردني: "شامي",
  خليجيه: "خليجي",
  سعودي: "خليجي",
  سعوديه: "خليجي",
  كويتي: "خليجي",
  اماراتي: "خليجي",
  مغربيه: "مغربي",
  ايطاليه: "إيطالي",
  تركيه: "تركي",
  هنديه: "هندي",
  مكسيكيه: "مكسيكي",
  صحيه: "صحي",
  سريعه: "سريع",
  مشويه: "مشوي",
  مقليه: "مقلي",
  فرن: "في الفرن",
};

export interface TaggableRecipe {
  title?: string | null;
  caption?: string | null;
  ingredients?: string[] | null;
  steps?: string[] | null;
  tags?: string[] | null;
  time_minutes?: number | null;
}

function has(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

export function canonicalizeTag(tag: string): string {
  const trimmed = String(tag || "").trim();
  if (!trimmed) return "";
  const normalized = arabicNormalize(trimmed);
  return ALIASES[normalized] || CANONICAL_BY_NORMALIZED.get(normalized) || trimmed;
}

export function tagGroupId(tag: string): string | null {
  const canonical = canonicalizeTag(tag);
  return TAG_GROUPS.find((group) => (group.tags as readonly string[]).includes(canonical))?.id || null;
}

/**
 * Normalize model-created tags and add stable, evidence-based classifications.
 * Cuisine tags use deliberately strong dish/region signals so we do not guess.
 */
export function classifyRecipeTags(recipe: TaggableRecipe): string[] {
  const original = (recipe.tags || []).map(canonicalizeTag).filter(Boolean);
  const tags = new Set(original);
  const title = arabicNormalize(recipe.title || "");
  const titleAndTags = arabicNormalize([recipe.title, ...(recipe.tags || [])].filter(Boolean).join(" "));
  const ingredientLines = (recipe.ingredients || []).map((item) => arabicNormalize(item));
  const fullText = arabicNormalize(
    [
      recipe.title,
      recipe.caption,
      ...(recipe.ingredients || []),
      ...(recipe.steps || []),
      ...(recipe.tags || []),
    ]
      .filter(Boolean)
      .join(" ")
  );

  const proteinRules: Array<[string, RegExp]> = [
    ["دجاج", /(?:^|\s)(?:دجاج|فراخ|فراخه|فراخات|وراك|صدور دجاج)(?:\s|$)/],
    ["لحوم", /(?:^|\s)(?:لحم|لحمه|لحوم|كفته|سجق|ستيك|بيف|ضاني|خروف|بتلو)(?:\s|$)/],
    ["مأكولات بحرية", /(?:جمبري|روبيان|قريدس|كاليماري|سبيط|سي فود|ماكولات بحريه)/],
    ["أسماك", /(?:^|\s)(?:سمك|اسماك|سلمون|تونه|بلطي|سردين)(?:\s|$)/],
    ["بيض", /(?:^|\s)(?:بيض|بيضه|بيضات)(?:\s|$)/],
  ];
  const stockOnly = /(?:مرقه|شوربه|مكعب|نكهه|بودره)/;
  for (const [tag, pattern] of proteinRules) {
    const inTitleOrTags = has(titleAndTags, pattern);
    const inRealIngredient = ingredientLines.some(
      (line) => has(line, pattern) && !has(line, stockOnly)
    );
    if (inTitleOrTags || inRealIngredient) tags.add(tag);
  }

  const dessert = tags.has("حلويات") || has(title, /(?:كيك|كيكه|بسبوسه|كنافه|حلويات|حلي|حلوى|كوكيز|براونيز|مهلبيه|بودينج|تشيز كيك|ام علي|ايس كريم|سويس رول|سويسرول|تيراميسو)/);
  const soup = has(title, /(?:شوربه|حساء)/);
  const salad = has(title, /(?:سلطه|تبوله|فتوش)/);
  const drink = has(title, /(?:عصير|سموذي|مشروب|قهوه|شاي|ميلك شيك)/);
  const sauce = has(title, /^(?:صوص|صلصه|تتبيله|دريسنج|مايونيز)(?:\s|$)/);
  const breakfast = has(title, /(?:فطور|افطار|بان كيك|اومليت|شكشوكه|فول|طعمية)/);
  const sandwich = has(title, /(?:ساندوتش|سندوتش|برجر|شاورما|راب\b)/);
  const pastry = has(title, /(?:فطير|فطيره|بيتزا|مناقيش|سمبوسه|عجينه|كرواسون)/);
  const baked = has(title, /(?:خبز|عيش|توست|مخبوز)/);
  const appetizer = has(title, /(?:مقبلات|حمص|بابا غنوج|متبل|محمّره|محمرة)/);

  if (dessert) { tags.delete("أطباق رئيسية"); tags.add("حلويات"); }
  else if (soup) tags.add("شوربات");
  else if (salad) tags.add("سلطات");
  else if (drink) tags.add("مشروبات");
  else if (sauce) tags.add("صلصات");
  else if (sandwich) tags.add("سندويتشات");
  else if (pastry) tags.add("معجنات");
  else if (baked) tags.add("مخبوزات");
  else if (appetizer) tags.add("مقبلات");
  else if (breakfast) tags.add("فطور");
  else if (!original.some((tag) => tagGroupId(tag) === "dish") && ((recipe.ingredients || []).length || (recipe.steps || []).length)) tags.add("أطباق رئيسية");

  const cuisineRules: Array<[string, RegExp]> = [
    ["مصري", /(?:مصري|كشري|طعمية|حواوشي|بصاره|فسيخ|رقاق|ام علي)/],
    ["شامي", /(?:شامي|لبناني|سوري|فلسطيني|اردني|تبوله|فتوش|كبه|مناقيش|مسخن|مقلوبه|محمّره|محمرة)/],
    ["خليجي", /(?:خليجي|سعودي|كويتي|اماراتي|قطري|بحريني|عماني|كبسه|مندي|مظبي|مجبوس|جريش|قرصان)/],
    ["مغربي", /(?:مغربي|طاجين|حريره|بسطيله|كسكس)/],
    ["تركي", /(?:تركي|اسكندر|بورك|لحم بعجين)/],
    ["إيطالي", /(?:ايطالي|ريزوتو|لازانيا|تيراميسو|كاربونارا|بولونيز)/],
    ["هندي", /(?:هندي|برياني|تندوري|ماسالا|دال\b)/],
    ["آسيوي", /(?:اسيوي|صيني|ياباني|كوري|سوشي|نودلز|ترياكي)/],
    ["مكسيكي", /(?:مكسيكي|تاكو|بوريتو|كيساديا|ناتشوز)/],
  ];
  for (const [tag, pattern] of cuisineRules) if (has(titleAndTags, pattern)) tags.add(tag);

  if (recipe.time_minutes != null && recipe.time_minutes <= 30) tags.add("سريع");
  if (has(fullText, /(?:بدون فرن|من غير فرن)/)) tags.add("بدون فرن");
  else if (has(fullText, /(?:في الفرن|ادخل.*الفرن|اخبز|خبزها)/)) tags.add("في الفرن");
  if (has(fullText, /(?:مشوي|مشويه|شوايه|على الفحم)/)) tags.add("مشوي");
  if (has(fullText, /(?:مقلي|مقليه|اقلي|زيت غزير)/)) tags.add("مقلي");
  if (has(fullText, /(?:قدر واحد|حله واحده|وعاء واحد)/)) tags.add("قدر واحد");
  if (has(fullText, /(?:عالي البروتين|بروتين عالي)/)) tags.add("عالي البروتين");

  const canonicalOrder = new Map<string, number>(
    CANONICAL_TAGS.map((tag, index) => [tag, index])
  );
  return [...tags].sort((a, b) => {
    const ai = canonicalOrder.get(a);
    const bi = canonicalOrder.get(b);
    if (ai != null && bi != null) return ai - bi;
    if (ai != null) return -1;
    if (bi != null) return 1;
    return a.localeCompare(b, "ar");
  });
}
