import Link from "next/link";
import { Icon } from "./Icon";

export default function NotFound() {
  return (
    <main id="main-content" className="container">
      <div className="notfound">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={72} height={72} className="brand-logo" />
        <h1>الصفحة غير موجودة</h1>
        <p>ربما حُذفت هذه الوصفة أو أن الرابط غير صحيح.</p>
        <Link href="/" className="btn-primary">
          <Icon name="back" size={17} /> العودة إلى كل الوصفات
        </Link>
      </div>
    </main>
  );
}
