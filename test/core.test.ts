import { test } from "node:test";
import assert from "node:assert/strict";
import { arabicNormalize } from "../lib/arabic";
import { canScale, normalizeQuantity, scaleIngredient, scaleInstruction } from "../lib/scale";
import { canonicalizeRecipeUrl, isDuplicateRecipe } from "../lib/dedupe";
import { facebookUrlFromLoginRedirect } from "../lib/pipeline";
import { canonicalizeTag, classifyRecipeTags, tagGroupId } from "../lib/tags";

test("Arabic search normalization removes marks and unifies variants", () => {
  assert.equal(arabicNormalize("  إِلى الحَلْوَىـ  "), "الي الحلوي");
  assert.equal(arabicNormalize("كُبَّة"), arabicNormalize("كبه"));
});

test("recipe tags normalize aliases and infer protein and cuisine from evidence", () => {
  assert.equal(canonicalizeTag("فراخ"), "دجاج");
  assert.equal(canonicalizeTag("لحمة"), "لحوم");
  assert.equal(tagGroupId("دجاج"), "protein");
  assert.deepEqual(
    classifyRecipeTags({
      title: "كبسة فراخ سريعة",
      ingredients: ["1 دجاجة", "2 كوب أرز بسمتي"],
      steps: ["تطهى المكونات في حلة واحدة"],
      tags: ["فراخ"],
      time_minutes: 25,
    }),
    ["أطباق رئيسية", "دجاج", "خليجي", "سريع", "قدر واحد"]
  );
});

test("recipe tags do not guess a cuisine without a strong signal", () => {
  const tags = classifyRecipeTags({
    title: "شرائح اللحم بالمشروم",
    ingredients: ["500 غ لحم بقري", "200 غ مشروم"],
    steps: ["تشوح شرائح اللحم"],
    tags: [],
  });
  assert.ok(tags.includes("لحوم"));
  assert.ok(!tags.includes("مصري"));
  assert.ok(!tags.includes("شامي"));
  assert.ok(!tags.includes("خليجي"));
});

test("desserts are not given the fallback main-dish category", () => {
  const tags = classifyRecipeTags({ title: "آيس كريم الفواكه", tags: ["حلويات", "أطباق رئيسية"], ingredients: ["2 موزة"] });
  assert.ok(tags.includes("حلويات"));
  assert.ok(!tags.includes("أطباق رئيسية"));
  assert.ok(!classifyRecipeTags({title: "دجاج بصوص المشروم", ingredients: ["500 غ دجاج"]}).includes("صلصات"));
});

test("stock cubes do not turn a chicken recipe into a meat recipe", () => {
  const tags = classifyRecipeTags({
    title: "صينية دجاج بالخضار",
    ingredients: ["1 دجاجة", "1 مكعب مرقة لحم"],
    steps: ["توضع الصينية في الفرن"],
    tags: [],
  });
  assert.ok(tags.includes("دجاج"));
  assert.ok(!tags.includes("لحوم"));
});

test("a chicken burger or burger cheese does not imply a meat recipe", () => {
  const tags = classifyRecipeTags({
    title: "برجر زنجر منزلي",
    ingredients: ["2 قطعة صدور دجاج", "2 شريحة جبنة برجر"],
    steps: ["يقلى الدجاج ثم يوضع في خبز البرجر"],
    tags: [],
  });
  assert.ok(tags.includes("دجاج"));
  assert.ok(!tags.includes("لحوم"));
});

test("quantity normalization handles Arabic digits, words, and dual nouns", () => {
  assert.equal(normalizeQuantity("٣ أكواب دقيق"), "3 أكواب دقيق");
  assert.equal(normalizeQuantity("نصف كوب حليب"), "½ كوب حليب");
  assert.equal(normalizeQuantity("كوبين حليب"), "2 كوب حليب");
});

test("ingredient scaling preserves text while scaling supported quantities", () => {
  assert.equal(scaleIngredient("1 ½ كوب دقيق", 2), "3 كوب دقيق");
  assert.equal(scaleIngredient("كوب سكر", 2), "2 كوب سكر");
  assert.equal(scaleIngredient("ملح حسب الرغبة", 2), "ملح حسب الرغبة");
  assert.equal(canScale("ملعقتين زيت"), true);
});

test("instruction scaling changes ingredient amounts but not time or temperature", () => {
  assert.equal(
    scaleInstruction("أضف 2 كوب دقيق وملعقة زيت ثم اخبز لمدة 20 دقيقة على 180 درجة", 0.5),
    "أضف 1 كوب دقيق و½ ملعقة زيت ثم اخبز لمدة 20 دقيقة على 180 درجة"
  );
  assert.equal(scaleInstruction("اخلط ٢٠٠غ دقيق مع نصف كوب حليب", 2), "اخلط 400غ دقيق مع 1 كوب حليب");
});

test("instruction scaling handles Arabic clitics, endings, duals, and mixed quantities", () => {
  assert.equal(
    scaleInstruction("تبل اللحم بملعقة ملح وملعقة فلفل", 0.5),
    "تبل اللحم بـ ½ ملعقة ملح و½ ملعقة فلفل"
  );
  assert.equal(
    scaleInstruction("تبله بنصف ملعقة ملح ونصف ملعقة فلفل", 0.5),
    "تبله بـ ¼ ملعقة ملح و¼ ملعقة فلفل"
  );
  assert.equal(
    scaleInstruction("أضف كوبًا من الشوربة ثم أضف الكوب الثاني", 0.5),
    "أضف ½ كوب من الشوربة ثم أضف ½ كوب إضافي"
  );
  assert.equal(scaleInstruction("ذوب ملعقتين زبدة", 0.5), "ذوب 1 ملعقة زبدة");
  assert.equal(scaleInstruction("اخفق ظرفي الكريم مع كوب ونصف حليب", 2), "اخفق 4 ظرف الكريم مع 3 كوب حليب");
  assert.equal(scaleInstruction("أضف 3 أكواب وربع ماء", 2), "أضف 6 ½ أكواب ماء");
});

test("instruction scaling leaves durations, partial batches, and ratios unchanged", () => {
  assert.equal(scaleInstruction("اتركه لمدة ساعتين ونصف", 2), "اتركه لمدة ساعتين ونصف");
  assert.equal(scaleInstruction("استخدم نصف كمية التتبيلة", 2), "استخدم نصف كمية التتبيلة");
  assert.equal(
    scaleInstruction("أضف الماء بنسبة كل كوب أرز إلى كوب ونصف ماء", 2),
    "أضف الماء بنسبة كل كوب أرز إلى كوب ونصف ماء"
  );
  assert.equal(
    scaleInstruction("أضف الدقيق بمعدل ملعقة لكل حبة بطاطس", 2),
    "أضف الدقيق بمعدل ملعقة لكل حبة بطاطس"
  );
  assert.equal(
    scaleInstruction("نظف المشروم وقطعه إلى شرائح ثم رشه بالملح", 0.5),
    "نظف المشروم وقطعه إلى شرائح ثم رشه بالملح"
  );
});

test("instruction scaling covers every amount format in the reported stroganoff recipe", () => {
  const steps = [
    "تبل شرائح اللحم بملعقة صغيرة من الملح وملعقة صغيرة من الفلفل الأسود.",
    "في نفس الطاسة، أضف البصل والمشروم وتبلهما بنصف ملعقة صغيرة ملح ونصف ملعقة صغيرة فلفل أسود.",
    "خفف النار وأضف ملعقة كبيرة من الزبدة، ثم أضف ملعقة كبيرة من الدقيق.",
    "أضف كوبًا من الشوربة، ثم أضف الكوب الثاني من الشوربة.",
    "ذوب ملعقتين كبيرتين من الزبدة.",
    "أضف ربع كوب من ماء السلق وملعقة كبيرة من كريمة الطهي.",
    "تبلها بنصف ملعقة صغيرة ملح ونصف ملعقة صغيرة فلفل أسود.",
  ];
  assert.deepEqual(steps.map((step) => scaleInstruction(step, 0.5)), [
    "تبل شرائح اللحم بـ ½ ملعقة صغيرة من الملح و½ ملعقة صغيرة من الفلفل الأسود.",
    "في نفس الطاسة، أضف البصل والمشروم وتبلهما بـ ¼ ملعقة صغيرة ملح و¼ ملعقة صغيرة فلفل أسود.",
    "خفف النار وأضف ½ ملعقة كبيرة من الزبدة، ثم أضف ½ ملعقة كبيرة من الدقيق.",
    "أضف ½ كوب من الشوربة، ثم أضف ½ كوب إضافي من الشوربة.",
    "ذوب 1 ملعقة كبيرة من الزبدة.",
    "أضف ⅛ كوب من ماء السلق و½ ملعقة كبيرة من كريمة الطهي.",
    "تبلها بـ ¼ ملعقة صغيرة ملح و¼ ملعقة صغيرة فلفل أسود.",
  ]);
});

test("recipe URL canonicalization removes share tracking and unifies variants", () => {
  assert.equal(
    canonicalizeRecipeUrl("https://www.instagram.com/reels/ABC123/?igsh=tracking&utm_source=copy"),
    "https://instagram.com/reel/ABC123/"
  );
  assert.equal(
    canonicalizeRecipeUrl("https://youtu.be/xyz987?si=tracking"),
    canonicalizeRecipeUrl("https://www.youtube.com/watch?v=xyz987&utm_source=share")
  );
});

test("Facebook login redirects expose the stable story URL", () => {
  const story = "https://www.facebook.com/story.php?story_fbid=1807322734034308&id=100069013472103&mibextid=share&rdid=abc&share_url=https%3A%2F%2Ffacebook.com%2Fshare%2Fv%2Fshort";
  const redirect = `https://www.facebook.com/login/?next=${encodeURIComponent(story)}`;
  assert.equal(
    facebookUrlFromLoginRedirect(redirect),
    "https://www.facebook.com/story.php?story_fbid=1807322734034308&id=100069013472103"
  );
});

test("duplicate detection only compares content across the same chef", () => {
  const original = {
    author: "Nadia Elsayed ناديه السيد",
    title: "كيكة المج بالشوكولاتة",
    ingredients: ["2 كوب دقيق", "1 كوب سكر", "½ كوب كاكاو", "3 بيضات"],
    steps: ["اخلط المكونات", "اخبز الكيكة"],
  };
  assert.equal(
    isDuplicateRecipe(original, {
      author: "ناديه السيد Nadia Elsayed",
      title: "كيكة الشوكولاتة في المج",
      ingredients: ["كوبان دقيق", "2 كوب سكر", "1 كوب كاكاو", "6 بيضات"],
      steps: [],
    }),
    true
  );
  assert.equal(
    isDuplicateRecipe(original, {
      author: "Different Chef",
      title: "كيكة المج بالشوكولاتة",
      ingredients: ["2 كوب دقيق", "1 كوب سكر", "½ كوب كاكاو", "3 بيضات"],
      steps: ["اخلط المكونات", "اخبز الكيكة"],
    }),
    false
  );
  assert.equal(
    isDuplicateRecipe(original, {
      author: "Nadia Elsayed ناديه السيد",
      title: "كيكة الشوكولاتة في المج",
      ingredients: ["تمر", "شوفان", "عسل"],
      steps: [],
    }),
    false
  );
});

test("duplicate detection still rejects the same canonical source without a chef", () => {
  assert.equal(
    isDuplicateRecipe(
      { source_url: "https://youtu.be/xyz987?si=one" },
      { source_url: "https://youtube.com/watch?v=xyz987&utm_source=two" }
    ),
    true
  );
});
