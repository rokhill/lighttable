/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
  webpack: (config) => {
    // pino (pulled in by WalletConnect) optionally requires pino-pretty, which
    // isn't needed at runtime. Mark it external so the build doesn't warn.
    config.externals.push("pino-pretty");
    return config;
  },
};

module.exports = nextConfig;
