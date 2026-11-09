'use client';

import { useEffect } from 'react';
import { canonicalAppDestination } from '../lib/veloxa-canonical-origin';

export function CanonicalAppOrigin() {
  useEffect(() => {
    const destination = canonicalAppDestination(window.location.href, process.env.NEXT_PUBLIC_APP_ORIGIN);
    if (destination) window.location.replace(destination);
  }, []);
  return null;
}
