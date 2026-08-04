/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // These three ship raw TypeScript/TSX — their package.json "main" points
  // at src/index.ts and none has a build step. Next has to compile them like
  // app code, or the first component import fails on unparsed JSX, and the
  // "use client" directives inside them are only honoured once it does.
  transpilePackages: ["@petrospecial/ui", "@petrospecial/i18n", "@petrospecial/app-shell"]
};

export default nextConfig;
