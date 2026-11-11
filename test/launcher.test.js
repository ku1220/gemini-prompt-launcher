import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_URL_BYTES, detectPlatform, appLink, prefilledQuestLink } from '../dist/launcher.js';
import { SPELLS, buildQuestPrompt } from '../dist/quest.js';

test('detects Android, iPhone and iPad with a desktop user agent', () => {
  assert.equal(detectPlatform('Mozilla Android 14'), 'android');
  assert.equal(detectPlatform('Mozilla iPhone'), 'ios');
  assert.equal(detectPlatform('Mozilla Macintosh', 5), 'ios');
  assert.equal(detectPlatform('Mozilla Macintosh', 0), 'web');
});
test('manual fallback stays on Google-owned HTTPS', () => {
  assert.equal(appLink('ios'), 'https://gemini.google.com/app/download/ios');
  assert.equal(appLink('android'), 'https://gemini.google.com/app/download/mobile');
  assert.equal(appLink('unknown'), 'https://gemini.google.com/app');
});
test('q handoff preserves every character, newline, emoji and query delimiter', () => {
  const prompt = '日本語\n魔法😀 & ? # = + % <script>prompt_action=autosubmit</script>';
  const result = prefilledQuestLink(prompt);
  const url = new URL(result.url);
  assert.equal(result.url, 'https://gemini.google.com/app?q=' + encodeURIComponent(prompt));
  assert.equal(url.origin, 'https://gemini.google.com');
  assert.equal(url.pathname, '/app');
  assert.equal(url.searchParams.get('q'), prompt);
  assert.deepEqual([...url.searchParams.keys()], ['q']);
});
test('all six full FF prompts fit the site guard and keep their selected magic', () => {
  for (const spell of SPELLS) {
    const prompt = buildQuestPrompt(spell.id);
    const result = prefilledQuestLink(prompt);
    assert.equal(result.error, null);
    assert.ok(result.bytes <= MAX_URL_BYTES);
    assert.equal(new URL(result.url).searchParams.get('q'), prompt);
  }
});
test('oversized prompts are rejected rather than silently shortened', () => {
  const base = 'https://gemini.google.com/app?q='.length;
  assert.ok(prefilledQuestLink('a'.repeat(MAX_URL_BYTES - base)).url);
  const result = prefilledQuestLink('a'.repeat(MAX_URL_BYTES - base + 1));
  assert.equal(result.url, null);
  assert.equal(result.bytes, MAX_URL_BYTES + 1);
  assert.ok(result.error);
  assert.equal(prefilledQuestLink('長文😀\n'.repeat(10_000)).url, null);
});
test('empty and malformed text return a usable fallback reason', () => {
  for (const text of ['', ' \n\t', null, '\ud800']) {
    const result = prefilledQuestLink(text);
    assert.equal(result.url, null);
    assert.ok(result.error);
  }
});
