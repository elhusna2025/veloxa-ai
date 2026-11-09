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
  serverExternalPackages: ['ffmpeg-static', 'ffprobe-static'],
  outputFileTracingIncludes: {
    '/api/veloxa/content': ['./node_modules/ffmpeg-static/index.js', './node_modules/ffmpeg-static/package.json', './node_modules/ffmpeg-static/ffmpeg', './node_modules/ffprobe-static/index.js', './node_modules/ffprobe-static/package.json', `./node_modules/ffprobe-static/bin/${process.platform}/${process.arch}/ffprobe`],
  },
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
};

export default nextConfig;
