"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="container notfound">
      <h1>تعذّر تحميل الصفحة</h1>
      <p>حاول مرة أخرى، أو ارجع إلى كتاب الوصفات.</p>
      <button className="btn-primary" onClick={reset}>إعادة المحاولة</button>
      <a className="btn-ghost" href="/">كل الوصفات</a>
    </main>
  );
}
