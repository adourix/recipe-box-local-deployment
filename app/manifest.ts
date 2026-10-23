import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  const m: Record<string, unknown> = {
    name: "كتاب وصفات عياد",
    short_name: "وصفات عياد",
    description: "معرض وصفاتي من انستغرام وفيسبوك",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    display: "standalone",
    background_color: "#faf6ef",
    theme_color: "#d9613b",
    icons: [
      { src: "/pwa-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon?size=512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Lets you Share a reel from IG/FB straight into the installed app.
    share_target: {
      action: "/share",
      method: "GET",
      enctype: "application/x-www-form-urlencoded",
      params: { title: "title", text: "text", url: "url" },
    },
  };
  return m as MetadataRoute.Manifest;
}
