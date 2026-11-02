import type { RuntimePlatform, SocialChannelId } from './veloxa-types';

/**
 * Cross-platform runtime bridge for Veloxa AI (Web Browser, Android Capacitor, iOS Capacitor).
 */
export function detectVeloxaRuntimePlatform(): RuntimePlatform {
  if (typeof window === 'undefined') return 'web';
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  if (cap && typeof cap.getPlatform === 'function') {
    const p = cap.getPlatform();
    if (p === 'android') return 'android';
    if (p === 'ios') return 'ios';
  }
  const ua = window.navigator.userAgent.toLowerCase();
  if (ua.includes('wv') && ua.includes('android')) return 'android';
  return 'web';
}

export async function pickBrandAssetFromDevice(options: {
  mediaType: 'photo' | 'video_reel';
}): Promise<{
  title: string;
  previewUrl: string;
  uploadedFrom: RuntimePlatform;
} | null> {
  const platform = detectVeloxaRuntimePlatform();

  // If running inside Android or iOS Capacitor shell with Camera plugin available
  if (platform !== 'web' && typeof window !== 'undefined') {
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const photo = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
      });
      if (photo.webPath) {
        return {
          title: `Aset Kamera/Galeri ${platform.toUpperCase()} · ${new Date().toLocaleTimeString('id-ID')}`,
          previewUrl: photo.webPath,
          uploadedFrom: platform,
        };
      }
    } catch {
      // Fallback to standard file input below if user cancels native sheet
    }
  }

  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = options.mediaType === 'video_reel' ? 'video/*,image/*' : 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      resolve({
        title: file.name.replace(/\.[^.]+$/, ''),
        previewUrl: objectUrl,
        uploadedFrom: platform,
      });
    };
    input.click();
  });
}

export function getCentralOAuthCallbackUri(channel: SocialChannelId | 'meta_ads'): {
  webCallbackUri: string;
  mobileDeepLinkUri: string;
  oauthProviderLabel: string;
} {
  const providerMap: Record<SocialChannelId | 'meta_ads', string> = {
    instagram: 'Meta Graph API (Instagram Business / Direct Login)',
    facebook: 'Meta Graph API (Facebook Page Publishing)',
    tiktok: 'TikTok Login Kit & Content Posting API (Direct Post)',
    youtube_shorts: 'Google OAuth 2.0 (YouTube Data API v3 Shorts)',
    meta_ads: 'Meta Marketing API (ads_management & ads_read)',
  };

  return {
    webCallbackUri: `https://asia-southeast2-veloxa-ai-cloud.cloudfunctions.net/oauthCallback?channel=${channel}`,
    mobileDeepLinkUri: `veloxa://oauth-callback/${channel}`,
    oauthProviderLabel: providerMap[channel],
  };
}
