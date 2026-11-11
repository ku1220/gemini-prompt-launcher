import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_URL_BYTES, MAX_PROMPT_LENGTH, detectPlatform, appLink, prefilledLink, shareLink, readIncomingPrompt, validatePrompt, byteLength } from '../dist/launcher.js';

test('experimental URL preserves Japanese, newlines, reserved symbols and emoji exactly', () => {
  const prompt = '日本語の長文\n二行目 😀 & ? # = + % <script>alert(1)</script>\r\n最後';
  const result = prefilledLink(prompt);
  assert.equal(new URL(result.url).searchParams.get('q'), prompt);
  assert.equal(new URL(result.url).origin, 'https://gemini.google.com');
});

test('long input is accepted for copying but never truncated into an outbound URL', () => {
  const text = '長文😀\n'.repeat(10_000);
  assert.equal(validatePrompt(text), null);
  const result = prefilledLink(text);
  assert.equal(result.url, null);
  assert.ok(result.bytes > MAX_URL_BYTES);
  assert.equal(text, '長文😀\n'.repeat(10_000));
});

test('URL guard accepts at limit and refuses one byte beyond', () => {
  const prefix = prefilledLink('a').bytes - 1;
  assert.equal(prefilledLink('a'.repeat(MAX_URL_BYTES - prefix)).bytes, MAX_URL_BYTES);
  assert.ok(prefilledLink('a'.repeat(MAX_URL_BYTES - prefix)).url);
  assert.equal(prefilledLink('a'.repeat(MAX_URL_BYTES - prefix + 1)).url, null);
});

test('blank and oversized inputs are rejected; full maximum is accepted', () => {
  for (const text of ['', ' \r\n\t', 'a'.repeat(MAX_PROMPT_LENGTH + 1)]) assert.ok(validatePrompt(text));
  assert.equal(validatePrompt('a'.repeat(MAX_PROMPT_LENGTH)), null);
});

test('native routes use Google-owned HTTPS and handle iPad desktop user agent', () => {
  assert.equal(detectPlatform('Mozilla Android 14'), 'android');
  assert.equal(detectPlatform('Mozilla iPhone'), 'ios');
  assert.equal(detectPlatform('Mozilla Macintosh', 5), 'ios');
  assert.equal(detectPlatform('Mozilla Macintosh', 0), 'web');
  assert.equal(appLink('ios'), 'https://gemini.google.com/app/download/ios');
  assert.equal(appLink('android'), 'https://gemini.google.com/app/download/mobile');
  assert.equal(appLink('untrusted'), 'https://gemini.google.com/app');
});

test('launcher query input is decoded once and removed without dropping unrelated parameters', () => {
  const text = 'テスト + %2F\n# & 😀';
  const url = new URL('https://example.com/tool/?theme=light#section');
  url.searchParams.set('prompt', text);
  const result = readIncomingPrompt(url.href);
  assert.equal(result.prompt, text);
  assert.equal(new URL(result.cleanUrl).searchParams.get('theme'), 'light');
  assert.equal(new URL(result.cleanUrl).searchParams.has('prompt'), false);
  assert.equal(new URL(result.cleanUrl).hash, '#section');
});

test('share links put prompt in fragment and round-trip at a repository subpath', () => {
  const text = '安全な共有\nA+B & 😀';
  const result = shareLink(text, 'https://ku1220.github.io/gemini-prompt-launcher/?foo=1#old');
  const url = new URL(result.url);
  assert.equal(url.pathname, '/gemini-prompt-launcher/');
  assert.equal(url.search, '');
  assert.equal(readIncomingPrompt(result.url).prompt, text);
  assert.equal(readIncomingPrompt(result.url).cleanUrl, 'https://ku1220.github.io/gemini-prompt-launcher/');
  assert.ok(shareLink('あ'.repeat(2_000), url.href).error);
});

test('fragment takes precedence and all prompt parameters are stripped even when rejected', () => {
  const result = readIncomingPrompt('https://example.com/?prompt=old&keep=yes#prompt=%20%20&tab=main');
  assert.equal(result.prompt, null);
  assert.ok(result.error);
  assert.equal(result.cleanUrl, 'https://example.com/?keep=yes#tab=main');
  assert.equal(readIncomingPrompt('https://example.com/').cleanUrl, null);
});

test('byte counts reflect UTF-8 rather than JavaScript code units', () => {
  assert.equal(byteLength('あ😀'), 7);
});
