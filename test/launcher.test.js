import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, appLink, registeredQuestLink } from '../dist/launcher.js';

test('detects Android, iPhone and iPad with a desktop user agent', () => {
  assert.equal(detectPlatform('Mozilla Android 14'), 'android');
  assert.equal(detectPlatform('Mozilla iPhone'), 'ios');
  assert.equal(detectPlatform('Mozilla Macintosh', 5), 'ios');
  assert.equal(detectPlatform('Mozilla Macintosh', 0), 'web');
});
test('manual launch routes stay on Google-owned HTTPS', () => {
  assert.equal(appLink('ios'), 'https://gemini.google.com/app/download/ios');
  assert.equal(appLink('android'), 'https://gemini.google.com/app/download/mobile');
  assert.equal(appLink('unknown'), 'https://gemini.google.com/app');
});
test('absent, unverified, non-Google and malformed links never enable automatic launch', () => {
  for (const entry of [null, undefined, {}, { ios: { url: 'https://gemini.google.com/' } },
    ...['javascript:alert(1)', 'https://other.example/app?prompt_id=test_id&prompt_action=autosubmit',
      'https://gemini.google.com/app?prompt_id=test_id&prompt_action=autosubmit',
      'https://gemini.google.com/app/download/mobile?prompt_id=test_id',
      'https://gemini.google.com/app/download/mobile?prompt_id=test_id&prompt_id=second_id&prompt_action=autosubmit'
    ].map(url => ({ ios: { url, verified: true } }))]) {
    assert.equal(registeredQuestLink(entry, 'ios'), null);
  }
});
test('keeps the complete tested URL unchanged and verifies platforms independently', () => {
  const url = 'https://gemini.google.com/app/download/mobile?mode=fast&target=image&prompt_id=test_ff_only&prompt_action=autosubmit&redirect=home&campaign_id=test';
  const entry = { android: { url, verified: true } };
  assert.equal(registeredQuestLink(entry, 'android'), url);
  assert.equal(registeredQuestLink(entry, 'ios'), null);
  assert.equal(registeredQuestLink(entry, 'web'), null);
});
