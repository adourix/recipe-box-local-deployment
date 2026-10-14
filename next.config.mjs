/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  images: {
    // ponytail: Vercel's free image-transformation quota ran out. Images already
    // live sized in Supabase Storage, so serve them straight.
    // Upgrade path: downscale once on upload in persistImage() if bandwidth bites.
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "uqvocwyzuepkwcynqluu.supabase.co" },
    ],
  },
};

export default nextConfig;
