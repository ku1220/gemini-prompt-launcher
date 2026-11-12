export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const mimeExtensions = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);

export function conversationUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://gemini.google.com' || !/^\/app\/[A-Za-z0-9_-]+$/.test(url.pathname)) return null;
    return url.origin + url.pathname;
  } catch {return null;}
}

export async function validatePhoto(photo, spellId, photoRequestId) {
  if (!photo || !mimeExtensions.has(photo.mime) || typeof photo.dataUrl !== 'string') throw new Error('JPEG・PNG・WebP形式の写真を選んでください。');
  if (!Number.isSafeInteger(photo.size) || photo.size < 1 || photo.size > MAX_PHOTO_BYTES) throw new Error('写真は8MB以下にしてください。');
  const prefix = `data:${photo.mime};base64,`;
  if (!photo.dataUrl.startsWith(prefix)) throw new Error('写真の形式を確認できませんでした。');
  const encoded = photo.dataUrl.slice(prefix.length);
  // Avoid nested repeated groups: a valid 8MiB image must not overflow the
  // regexp engine's stack. atob and the decoded byte length validate padding.
  if (encoded.length !== 4 * Math.ceil(photo.size / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('写真のデータが正しくありません。');
  const binary = atob(encoded);
  if (binary.length !== photo.size) throw new Error('写真のサイズが一致しません。');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const isWebp = binary.slice(0, 4) === 'RIFF' && binary.slice(8, 12) === 'WEBP';
  if (!(photo.mime === 'image/jpeg' && isJpeg || photo.mime === 'image/png' && isPng || photo.mime === 'image/webp' && isWebp)) throw new Error('画像の内容と形式が一致しません。');
  const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const digest = Array.from(digestBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    photo: {dataUrl: photo.dataUrl, size: photo.size, mime: photo.mime, name: `crystal-quest-${spellId}-${photoRequestId.slice(0, 8)}.${mimeExtensions.get(photo.mime)}`},
    metadata: {photoMime: photo.mime, photoSize: photo.size, photoDigest: digest},
  };
}
