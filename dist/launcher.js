export const GEMINI_WEB_URL = 'https://gemini.google.com/app';
// Conservative site guard, not a published Gemini/OS limit.
export const MAX_URL_BYTES = 8_000;

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

export function prefilledQuestLink(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) return { url: null, bytes: 0, error: 'プロンプトが空です。' };
  try {
    const url = `${GEMINI_WEB_URL}?q=${encodeURIComponent(prompt)}`;
    const bytes = new TextEncoder().encode(url).length;
    if (bytes > MAX_URL_BYTES) return { url: null, bytes, error: 'URLが長すぎるため、全文コピーでGeminiへ渡してください。' };
    return { url, bytes, error: null };
  } catch { return { url: null, bytes: 0, error: 'URLに変換できない文字が含まれています。全文コピーを使ってください。' }; }
}
