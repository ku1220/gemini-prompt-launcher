export const MAX_PROMPT_LENGTH = 200_000;
// A conservative product guard, not a published Gemini or OS limit.
export const MAX_URL_BYTES = 8_000;
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

export function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

export function validatePrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) return 'プロンプトを入力してください。';
  if (prompt.length > MAX_PROMPT_LENGTH) return `プロンプトは${MAX_PROMPT_LENGTH.toLocaleString('ja-JP')}文字以内にしてください。`;
  return null;
}

export function prefilledLink(prompt) {
  const error = validatePrompt(prompt);
  if (error) return { url: null, bytes: 0, error };
  const url = new URL(GEMINI_WEB_URL);
  url.searchParams.set('q', prompt);
  const bytes = byteLength(url.href);
  if (bytes > MAX_URL_BYTES) return { url: null, bytes, error: 'URLが8,000バイトを超えます。全文コピーを使ってください。' };
  return { url: url.href, bytes, error: null };
}

export function shareLink(prompt, location) {
  const error = validatePrompt(prompt);
  if (error) return { url: null, error };
  const url = new URL(location);
  url.search = '';
  url.hash = new URLSearchParams({ prompt }).toString();
  if (byteLength(url.href) > MAX_URL_BYTES) return { url: null, error: '共有URLが長すぎます。テキストとして保存して共有してください。' };
  return { url: url.href, error: null };
}

// This parameter belongs to our launcher; it is not a Gemini URL contract.
export function readIncomingPrompt(location) {
  const url = new URL(location);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const fromFragment = fragment.has('prompt');
  const source = fromFragment ? fragment : url.searchParams;
  if (!source.has('prompt')) return { prompt: null, error: null, cleanUrl: null };
  const prompt = source.get('prompt');
  url.searchParams.delete('prompt');
  if (fromFragment) {
    fragment.delete('prompt');
    url.hash = fragment.toString();
  }
  const error = validatePrompt(prompt);
  return { prompt: error ? null : prompt, error, cleanUrl: url.href };
}
