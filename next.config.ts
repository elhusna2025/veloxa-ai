// Node.js v25+ introduces an incomplete global localStorage when --localstorage-file is missing.
// This safely deletes it so Server Components and SSR evaluate gracefully.
if (typeof globalThis.localStorage !== 'undefined' && typeof globalThis.localStorage.getItem !== 'function') {
  try {
    delete (globalThis as Record<string, unknown>).localStorage;
  } catch {
    // ignore
  }
}

import type { NextConfig } from 'next';

const isMobileExport = process.env.NEXT_OUTPUT_EXPORT === 'true';

const nextConfig: NextConfig = {
  ...(isMobileExport ? { output: 'export' } : {}),
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg', 'ffprobe-static', 'openai', 'ws'],
  outputFileTracingIncludes: {
    '/api/veloxa/content': ['./node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf', './node_modules/@ffmpeg-installer/ffmpeg/index.js', './node_modules/@ffmpeg-installer/ffmpeg/package.json', './node_modules/@ffmpeg-installer/ffmpeg/lib/verify-file.js', `./node_modules/@ffmpeg-installer/${process.platform}-${process.arch}/ffmpeg`, `./node_modules/@ffmpeg-installer/${process.platform}-${process.arch}/package.json`, './node_modules/ffprobe-static/index.js', './node_modules/ffprobe-static/package.json', `./node_modules/ffprobe-static/bin/${process.platform}/${process.arch}/ffprobe`],
  },
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
};

export default nextConfig;
