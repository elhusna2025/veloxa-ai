export const LEGACY_VELOXA_ORIGIN = 'https://veloxa-ai--veloxa-ai-saas.asia-southeast1.hosted.app';

function isSensitiveParameterName(name: string): boolean {
  const normalized = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const segments = normalized.split(/[^a-z0-9]+/);
  return segments.some(segment => ['token', 'secret', 'password', 'credential', 'authorization', 'auth', 'code', 'session', 'state', 'verifier', 'jwt', 'bearer'].includes(segment))
    || /(?:^|_)(?:api|client)_key(?:_|$)/.test(normalized);
}

function filterSensitiveParameters(parameters: URLSearchParams): string {
  const safeParameters = new URLSearchParams();
  parameters.forEach((value, name) => {
    if (!isSensitiveParameterName(name)) safeParameters.append(name, value);
  });
  return safeParameters.toString();
}

function sanitizeFragment(hash: string): string {
  const fragment = hash.slice(1);
  const queryStart = fragment.indexOf('?');
  const prefix = queryStart >= 0 ? fragment.slice(0, queryStart + 1) : '';
  const parameterText = queryStart >= 0 ? fragment.slice(queryStart + 1) : fragment;
  if (!parameterText.includes('=')) return hash;
  return `#${prefix}${filterSensitiveParameters(new URLSearchParams(parameterText))}`;
}

/** Move page navigation to the configured official origin; OAuth callbacks stay server-owned. */
export function canonicalAppDestination(currentHref: string, configuredOrigin?: string): string | null {
  if (!configuredOrigin) return null;
  try {
    const current = new URL(currentHref);
    const target = new URL(configuredOrigin);
    if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) return null;
    if (current.origin !== LEGACY_VELOXA_ORIGIN || current.origin === target.origin) return null;
    if (current.pathname === '/api' || current.pathname.startsWith('/api/') || current.pathname === '/__/auth' || current.pathname.startsWith('/__/auth/')) return null;
    // Assign fields rather than resolving a possibly protocol-relative path against the origin.
    target.pathname = current.pathname;
    target.search = filterSensitiveParameters(new URLSearchParams(current.search))
      ? `?${filterSensitiveParameters(new URLSearchParams(current.search))}`
      : '';
    target.hash = sanitizeFragment(current.hash);
    return target.toString();
  } catch {
    return null;
  }
}
