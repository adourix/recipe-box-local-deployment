import type { Metadata, Viewport } from "next";
import { Tajawal } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { RegisterSW } from "./SW";
import { ToastHost } from "./Toast";

const themeInit = `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&window.matchMedia&&matchMedia("(prefers-color-scheme:dark)").matches)){document.documentElement.setAttribute("data-theme","dark");}}catch(e){}})();`;
const isVercel = process.env.VERCEL === "1";

const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://recipes.amirshetaia.com"),
  title: "كتاب وصفات أمير",
  description: "وصفاتي المحفوظة من انستغرام وفيسبوك",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "كتاب وصفات أمير",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "كتاب وصفات أمير",
    description: "وصفاتي المحفوظة من انستغرام وفيسبوك",
    type: "website",
    locale: "ar_AR",
  },
  twitter: {
    card: "summary_large_image",
    title: "كتاب وصفات أمير",
    description: "وصفاتي المحفوظة من انستغرام وفيسبوك",
  },
};

export const viewport: Viewport = {
  themeColor: "#d9613b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        {/* Applies saved/system theme before paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className={tajawal.className}>
        <a className="skip-link" href="#main-content">انتقل إلى المحتوى</a>
        {children}
        <ToastHost />
        <RegisterSW />
        {isVercel && <Analytics />}
        {isVercel && <SpeedInsights />}
      </body>
    </html>
  );
}
