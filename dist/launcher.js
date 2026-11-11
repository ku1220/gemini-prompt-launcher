export const GEMINI_WEB_URL = 'https://gemini.google.com/app';

export function detectPlatform(userAgent = '', touchPoints = 0) {
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && touchPoints > 1)) return 'ios';
  return 'web';
}

export function appLink(platform) {
  if (platform === 'ios') return 'https://gemini.google.com/app/download/ios';
  if (platform === 'android') return 'https://gemini.google.com/app/download/mobile';
  return GEMINI_WEB_URL;
}

export function registeredQuestLink(entry, platform) {
  // Never derive a new route or share a verification flag across platforms.
  const configured = entry?.[platform];
  if (!configured || configured.verified !== true || typeof configured.url !== 'string') return null;
  try {
    const url = new URL(configured.url);
    if (url.origin !== 'https://gemini.google.com' || url.username || url.password || url.hash) return null;
    const paths = platform === 'web' ? ['/', '/app'] : ['/app/download/mobile', '/app/download/ios'];
    if (!paths.includes(url.pathname)) return null;
    if (url.searchParams.getAll('prompt_id').length !== 1 || !/^[A-Za-z0-9_-]{6,128}$/.test(url.searchParams.get('prompt_id'))) return null;
    if (url.searchParams.getAll('prompt_action').length !== 1 || url.searchParams.get('prompt_action') !== 'autosubmit') return null;
    return configured.url;
  } catch { return null; }
}
