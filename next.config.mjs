/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep a self-contained production build for direct Node.js execution.
  output: "standalone",
  images: {
    // Recipe images are already served by Supabase Storage.
    unoptimized: true,
  },
};

export default nextConfig;
