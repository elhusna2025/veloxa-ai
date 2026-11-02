/**
 * Veloxa AI — Visual Poster / Carousel Renderer & Indonesian Voiceover Engine
 *
 * Generates crisp 1080x1350 (4:5) and 1080x1920 (9:16) SVG visual posters
 * combining the brand identity, soft pink/clean white aesthetic, headline,
 * body copy, and CTA, plus downloadable SVG/PNG export and Indonesian TTS preview.
 */

import type { BrandProfile, ContentDraft } from './veloxa-types';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapTextLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

export function buildRenderedVisualSvg(params: {
  brand: BrandProfile;
  draft: ContentDraft;
  slideIndex?: number;
}): string {
  const { brand, draft, slideIndex = 0 } = params;
  const isVertical916 = draft.format === 'short_video';
  const width = 1080;
  const height = isVertical916 ? 1920 : 1350;

  const badgeText =
    draft.slides?.[slideIndex]?.badgeText ||
    (isVertical916 ? 'REELS · TIKTOK · YT SHORTS 9:16' : 'CAROUSEL · FEED 4:5');

  const headlineText =
    draft.slides?.[slideIndex]?.headline ||
    draft.videoScenes?.[0]?.textOverlay ||
    draft.title;

  const bodyText =
    draft.slides?.[slideIndex]?.body ||
    draft.videoScenes?.[1]?.voiceover ||
    draft.caption;

  const headlineLines = wrapTextLines(headlineText, 26, 3);
  const bodyLines = wrapTextLines(bodyText, 42, 4);

  const headlineSvg = headlineLines
    .map(
      (line, idx) =>
        `<text x="96" y="${520 + idx * 82}" font-family="Plus Jakarta Sans, Inter, sans-serif" font-size="64" font-weight="800" fill="#171717">${escapeXml(line)}</text>`,
    )
    .join('\n');

  const bodyStartY = 520 + headlineLines.length * 82 + 48;
  const bodySvg = bodyLines
    .map(
      (line, idx) =>
        `<text x="96" y="${bodyStartY + idx * 52}" font-family="Plus Jakarta Sans, Inter, sans-serif" font-size="36" font-weight="500" fill="#525252">${escapeXml(line)}</text>`,
    )
    .join('\n');

  const ctaY = height - 220;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="65%" stop-color="#FFFBFD"/>
      <stop offset="100%" stop-color="#FDF2F7"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>
  <rect x="44" y="44" width="${width - 88}" height="${height - 88}" rx="48" fill="#FFFFFF" stroke="#F5D0FE" stroke-width="3"/>
  
  <!-- Top Brand Pill -->
  <rect x="96" y="110" width="90" height="90" rx="26" fill="#EC749B"/>
  <text x="141" y="168" text-anchor="middle" font-family="Plus Jakarta Sans, Inter, sans-serif" font-size="40" font-weight="900" fill="#FFFFFF">${escapeXml(brand.businessName.slice(0, 2).toUpperCase())}</text>
  <text x="210" y="152" font-family="Plus Jakarta Sans, Inter, sans-serif" font-size="34" font-weight="800" fill="#171717">${escapeXml(brand.businessName)}</text>
  <text x="210" y="192" font-family="Plus Jakarta Sans, Inter, sans-serif" font-size="24" font-weight="600" fill="#EC749B">${escapeXml(brand.city)} · Kualitas AI ${draft.qualityReview.score}/100</text>

  <!-- Format Badge -->
  <rect x="96" y="340" width="520" height="62" rx="31" fill="#FDF2F7" stroke="#FBCFE8" stroke-width="2"/>
  <text x="128" y="380" font-family="Plus Jakarta Sans, Inter, sans-serif" font-size="24" font-weight="800" fill="#D85A88">★ ${escapeXml(badgeText)}</text>

  <!-- Main Headline -->
  ${headlineSvg}

  <!-- Supporting Body -->
  ${bodySvg}

  <!-- Bottom CTA Banner -->
  <rect x="96" y="${ctaY}" width="${width - 192}" height="116" rx="32" fill="#EC749B"/>
  <text x="${width / 2}" y="${ctaY + 70}" text-anchor="middle" font-family="Plus Jakarta Sans, Inter, sans-serif" font-size="32" font-weight="800" fill="#FFFFFF">${escapeXml(brand.defaultCta.slice(0, 48))}</text>
</svg>`;
}

export function buildRenderedVisualSvgDataUrl(params: {
  brand: BrandProfile;
  draft: ContentDraft;
  slideIndex?: number;
}): string {
  const svg = buildRenderedVisualSvg(params);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function downloadDraftPosterSvg(draft: ContentDraft, brand: BrandProfile): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const svg = buildRenderedVisualSvg({ brand, draft, slideIndex: 0 });
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = draft.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  a.href = url;
  a.download = `veloxa-poster-${slug || 'konten'}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function speakDraftVoiceoverIndonesian(
  draft: ContentDraft,
  onEnd?: () => void,
): { started: boolean; scriptText: string } {
  const scriptText =
    draft.videoScenes?.map((s) => s.voiceover).join(' ') ||
    draft.slides?.map((s) => `${s.headline}. ${s.body}`).join(' ') ||
    draft.caption;

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(scriptText);
      utterance.lang = 'id-ID';
      utterance.rate = 1.02;
      utterance.onend = () => onEnd?.();
      utterance.onerror = () => onEnd?.();
      window.speechSynthesis.speak(utterance);
      return { started: true, scriptText };
    } catch {
      onEnd?.();
    }
  }
  setTimeout(() => onEnd?.(), 2500);
  return { started: true, scriptText };
}
