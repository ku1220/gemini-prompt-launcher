import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createHash, webcrypto} from 'node:crypto';
import {buildQuestPrompt} from '../dist/quest.js';

const source = (await readFile(new URL('../local/extension/photo-driver.js', import.meta.url), 'utf8')).replace(/^export /gm, '');
const promptContext = vm.createContext({buildQuestPrompt});
new vm.Script((await readFile(new URL('../local/extension/local-prompt.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '')).runInContext(promptContext);
const prompt = promptContext.buildLocalQuestPrompt('ultima');
const expectedUrl = 'https://gemini.google.com/app';
const generatedUrl = 'https://gemini.google.com/app/newconversation123';
const requestId = 'quest-request-00000001';
const photoRequestId = 'photo-request-00000001';
const photo = {name: 'crystal-quest.jpg', mime: 'image/jpeg', size: 3, dataUrl: 'data:image/jpeg;base64,/9j/'};
const photoBytes = Buffer.from('/9j/', 'base64');
const photoDigest = createHash('sha256').update(photoBytes).digest('hex');

function fixture({url = expectedUrl, prepared = false, markerMissing = false, outputCount = 1, responseText = '', wrongUserPrompt = false, labelledQuery = false, hasHistory = false, hasExistingAttachment = false, finalUrl = generatedUrl, navigateAfterBinding = false, existingDraft = '', restoredDraft = '', avatarOnly = false, uploadStillBusy = false, noFileInput = false, pasteAccepted = true, unnamedPreview = false, blobBytes = photoBytes, previewSource, navigateOnFetch = false} = {}) {
  let clock = 1000;
  let clicked = 0;
  let uploadCount = 0;
  let pasteCount = 0;
  let fetchCount = 0;
  let context;
  let uploaded = prepared || hasExistingAttachment;
  let inputText = prepared ? prompt : existingDraft;
  const attrs = (values = {}) => (key) => values[key] ?? null;
  function node(text = '', properties = {}) {
    return {innerText: text, isConnected: true, contains: () => false, getClientRects: () => [{width: 400, height: 300}], getBoundingClientRect: () => ({width: 400, height: 300}), getAttribute: attrs(), querySelectorAll: () => [], ...properties};
  }
  function img(src, size = 400, attributes = {}) {
    return node('', {src, currentSrc: src, complete: true, naturalWidth: 800, naturalHeight: 600, getBoundingClientRect: () => ({width: size, height: size}), getAttribute: attrs(attributes)});
  }
  const uploadedImg = img(previewSource || (unnamedPreview ? 'blob:https://gemini.google.com/camera-test' : 'blob:uploaded-input'), 80, unnamedPreview ? {} : {alt: photo.name});
  const removeLabel = unnamedPreview ? '添付ファイルを閉じる' : `${photo.name} を削除`;
  const remove = node('', {getAttribute: attrs({'aria-label': removeLabel})});
  const fileInput = node('', {disabled: false, files: prepared ? [{name: photo.name, type: photo.mime, size: photo.size}] : [], getAttribute: attrs({accept: 'image/*'}), dispatchEvent() {uploadCount++; uploaded = true;}});
  const composer = node(unnamedPreview ? '' : photo.name, {querySelectorAll(selector) {
    if (selector === 'img') return uploaded ? [uploadedImg] : [];
    const aria = selector.match(/^button\[aria-label(\*?=)"([^"]+)"\]$/);
    if (aria) return uploaded && (aria[1] === '*=' ? removeLabel.includes(aria[2]) : removeLabel === aria[2]) ? [remove] : [];
    if (selector === 'uploader-file-preview') return uploaded ? [node(photo.name)] : [];
    if (selector === '[role="progressbar"]') return uploaded && uploadStillBusy ? [node()] : [];
    return [];
  }});
  class FakeTextArea {
    get value() {return inputText;}
    set value(value) {inputText = value;}
  }
  const editor = Object.assign(new FakeTextArea(), node('', {focus() {}, dispatchEvent(event) {
    if (event.type === 'paste') {
      pasteCount++;
      assert.equal(event.clipboardData.files.length, 1);
      assert.equal(event.clipboardData.files[0].name, photo.name);
      assert.equal(event.clipboardData.files[0].type, photo.mime);
      assert.equal(event.clipboardData.files[0].size, photo.size);
      if (pasteAccepted) {uploadCount++; uploaded = true;}
    }
  }, closest: () => composer}));
  const firstUser = node('以前の会話');
  const sentPrompt = wrongUserPrompt ? 'another quest' : prompt;
  const queryLines = sentPrompt.split('\n').map((text) => node(text));
  const nestedLine = node(queryLines[0].innerText);
  queryLines[0].contains = (other) => other === nestedLine;
  const photoUser = node(labelledQuery ? `あなたのプロンプト ${prompt.slice(0, 111)}…\n${sentPrompt}` : sentPrompt, {querySelectorAll(selector) {
    if (selector === 'img') return [uploadedImg];
    if (selector === '.query-text-line') return labelledQuery ? [queryLines[0], nestedLine, ...queryLines.slice(1)] : [];
    return [];
  }});
  const firstModel = node('以前の回答');
  const outputImages = Array.from({length: outputCount}, (_, index) => img(`blob:generated-${index}`, avatarOnly ? 24 : 400));
  const imageModel = node(responseText, {querySelectorAll: (selector) => selector === 'img' ? outputImages : []});
  const send = node('', {disabled: false, click() {clicked++; inputText = restoredDraft; uploaded = false; context.location = new URL(finalUrl);}});
  const root = node('', {querySelectorAll(selector) {
    if (selector === 'rich-textarea [contenteditable="true"][role="textbox"]') return [editor];
    if (selector === 'user-query') return clicked ? [photoUser] : hasHistory ? [firstUser] : [];
    if (selector === 'model-response') return clicked ? [imageModel] : hasHistory ? [firstModel] : [];
    if (selector === 'model-response .markdown') return clicked && responseText ? [node(responseText)] : [];
    if (selector === 'button[aria-label="プロンプトを送信"]') return [send];
    if (selector === 'input[type="file"]') return noFileInput ? [] : [fileInput];
    return [];
  }});
  const dataset = {};
  if (prepared && !markerMissing) dataset.crystalQuestPhoto = JSON.stringify({requestId, photoRequestId, name: photo.name, size: photo.size, mime: photo.mime, digest: photoDigest, expectedPath: new URL(expectedUrl).pathname, userCount: 0, modelCount: 0, sent: false});
  class FakeFile {
    constructor(parts, name, options) {this.name = name; this.type = options.type; this.size = parts.reduce((sum, part) => sum + part.length, 0);}
  }
  class FakeDataTransfer {
    constructor() {this.files = []; this.items = {add: (file) => this.files.push(file)};}
  }
  context = vm.createContext({
    URL, location: new URL(url), window: {}, document: {querySelector: () => root, querySelectorAll: (selector) => root.querySelectorAll(selector), body: root, documentElement: {dataset}},
    getComputedStyle: () => ({display: 'block', visibility: 'visible'}),
    Date: {now: () => clock},
    setTimeout(fn, ms) {return setTimeout(() => {clock += ms; if (clicked && navigateAfterBinding) context.location = new URL('https://gemini.google.com/app/anotherconversation'); fn();}, 0);},
    setInterval, clearInterval,
    atob: (text) => Buffer.from(text, 'base64').toString('binary'),
    File: FakeFile, DataTransfer: FakeDataTransfer, HTMLTextAreaElement: FakeTextArea,
    crypto: webcrypto, AbortSignal,
    async fetch(url, options) {
      fetchCount++;
      assert.equal(url, uploadedImg.currentSrc);
      assert.ok(options.signal);
      if (navigateOnFetch) context.location = new URL('https://gemini.google.com/app/anotherconversation');
      return {blob: async () => new Blob([blobBytes], {type: photo.mime})};
    },
    InputEvent: class {constructor(type, options) {this.type = type; Object.assign(this, options);}},
    ClipboardEvent: class {constructor(type, options) {this.type = type; Object.assign(this, options);}},
    Event: class {constructor(type, options) {this.type = type; Object.assign(this, options);}},
    chrome: {runtime: {sendMessage: async () => ({ok: true})}},
  });
  context.window.top = context.window;
  new vm.Script(source).runInContext(context);
  return {
    clicks: () => clicked, uploads: () => uploadCount, pastes: () => pasteCount, fetches: () => fetchCount, draft: () => inputText, dataset, fileInput,
    run: (extra = {}) => context.runPhotoDriver({phase: 'send', expectedUrl, prompt, requestId, photoRequestId, photoDigest, timeoutMs: 6000, ...extra}),
  };
}

test('another conversation, origin or existing history cannot attach or send a photo', async () => {
  for (const change of [{url: 'https://gemini.google.com/app/otherconversation'}, {url: 'https://example.com/app/testconversation123'}, {hasHistory: true}]) {
    const driver = fixture(change);
    assert.equal((await driver.run({phase: 'prepare', photo})).status, 'needs_attention');
    assert.equal(driver.uploads(), 0);
    assert.equal(driver.clicks(), 0);
  }
});

test('prepare verifies a single uploaded image before returning photo_ready', async () => {
  const driver = fixture();
  const result = await driver.run({phase: 'prepare', photo});
  assert.equal(result.status, 'photo_ready');
  assert.equal(result.photoAttachmentConfirmed, true);
  assert.equal(driver.uploads(), 1);
  assert.equal(driver.clicks(), 0);
  assert.equal(JSON.parse(driver.dataset.crystalQuestPhoto).photoRequestId, photoRequestId);
  assert.equal(driver.draft(), prompt);
  assert.equal(JSON.parse(driver.dataset.crystalQuestPhoto).userCount, 0);
});

test('Gemini without a file input receives one file-paste event and waits for the preview', async () => {
  const driver = fixture({noFileInput: true});
  const result = await driver.run({phase: 'prepare', photo});
  assert.equal(result.status, 'photo_ready');
  assert.equal(result.photoAttachmentConfirmed, true);
  assert.equal(driver.pastes(), 1);
  assert.equal(driver.uploads(), 1);
  assert.equal(driver.fileInput.files.length, 0);
  assert.equal(driver.clicks(), 0);
});

test('an ignored image paste times out without another paste or a send', async () => {
  const driver = fixture({noFileInput: true, pasteAccepted: false});
  const result = await driver.run({phase: 'prepare', photo, timeoutMs: 1000});
  assert.equal(result.status, 'needs_attention');
  assert.equal(driver.pastes(), 1);
  assert.equal(driver.uploads(), 0);
  assert.equal(driver.clicks(), 0);
  assert.equal(driver.dataset.crystalQuestPhoto, undefined);
});

test('unnamed Gemini blob preview must match the uploaded photo bytes', async () => {
  const matched = fixture({noFileInput: true, unnamedPreview: true});
  const result = await matched.run({phase: 'prepare', photo});
  assert.equal(result.status, 'photo_ready');
  assert.equal(matched.pastes(), 1);
  assert.equal(matched.fetches(), 1);
  assert.equal(matched.clicks(), 0);
  assert.equal(JSON.parse(matched.dataset.crystalQuestPhoto).digest, photoDigest);

  const different = fixture({noFileInput: true, unnamedPreview: true, blobBytes: Buffer.from([0, 1, 2])});
  assert.equal((await different.run({phase: 'prepare', photo, timeoutMs: 1200})).status, 'needs_attention');
  assert.equal(different.pastes(), 1);
  assert.equal(different.fetches(), 1);
  assert.equal(different.clicks(), 0);
});

test('photo bytes are checked again before send, and digest mismatch cannot send', async () => {
  const matched = fixture({prepared: true, noFileInput: true, unnamedPreview: true});
  assert.equal((await matched.run()).status, 'completed');
  assert.equal(matched.fetches(), 1);
  assert.equal(matched.clicks(), 1);

  const changed = fixture({prepared: true, noFileInput: true, unnamedPreview: true, blobBytes: Buffer.from([0, 1, 2])});
  assert.equal((await changed.run()).status, 'needs_attention');
  assert.equal(changed.clicks(), 0);
  const changedDigest = fixture({prepared: true});
  assert.equal((await changedDigest.run({photoDigest: '0'.repeat(64)})).status, 'needs_attention');
  assert.equal(changedDigest.clicks(), 0);
});

test('foreign preview URLs are not fetched or accepted as the captured photo', async () => {
  const driver = fixture({noFileInput: true, unnamedPreview: true, previewSource: 'blob:https://evil.example/camera-test'});
  assert.equal((await driver.run({phase: 'prepare', photo, timeoutMs: 1200})).status, 'needs_attention');
  assert.equal(driver.fetches(), 0);
  assert.equal(driver.clicks(), 0);
});

test('a conversation switch while hashing the preview prevents send', async () => {
  const driver = fixture({prepared: true, noFileInput: true, unnamedPreview: true, navigateOnFetch: true});
  assert.equal((await driver.run()).status, 'needs_attention');
  assert.equal(driver.fetches(), 1);
  assert.equal(driver.clicks(), 0);
});

test('invalid image bytes, unrelated draft or an unfinished upload never sends', async () => {
  for (const change of [{existingDraft: '大事な未送信の下書き'}, {hasExistingAttachment: true}, {uploadStillBusy: true}]) {
    const driver = fixture(change);
    assert.equal((await driver.run({phase: 'prepare', photo, timeoutMs: 1000})).status, 'needs_attention');
    assert.equal(driver.clicks(), 0);
  }
  const invalid = fixture();
  assert.equal((await invalid.run({phase: 'prepare', photo: {...photo, size: 4}})).status, 'failed');
  assert.equal(invalid.uploads(), 0);
});

test('missing or mismatched preparation marker stops before clicking send', async () => {
  const driver = fixture({prepared: true, markerMissing: true});
  assert.equal((await driver.run()).status, 'needs_attention');
  assert.equal(driver.clicks(), 0);
  const mismatch = fixture({prepared: true});
  assert.equal((await mismatch.run({photoRequestId: 'photo-request-00000002'})).status, 'needs_attention');
  assert.equal(mismatch.clicks(), 0);
});

test('uploaded user photo and a high-resolution avatar are not generated output', async () => {
  for (const change of [{outputCount: 0}, {avatarOnly: true}]) {
    const driver = fixture({prepared: true, ...change});
    const result = await driver.run({timeoutMs: 1200});
    assert.equal(result.status, 'needs_attention');
    assert.equal(result.photoSubmissionConfirmed, true);
    assert.equal(result.imageCount, 0);
    assert.equal(driver.clicks(), 1);
  }
});

test('one new model image completes the flow after exactly one send', async () => {
  const driver = fixture({prepared: true});
  const result = await driver.run();
  assert.equal(result.status, 'completed');
  assert.equal(result.imageCount, 1);
  assert.equal(result.url, generatedUrl);
  assert.equal(result.photoSubmissionConfirmed, true);
  assert.equal(driver.clicks(), 1);
  // Replaying the send phase cannot click again, even within the same DOM.
  assert.equal((await driver.run()).status, 'needs_attention');
  assert.equal(driver.clicks(), 1);
});

test('Gemini screen-reader query headings are excluded while full prompt lines match exactly', async () => {
  const labelled = fixture({prepared: true, labelledQuery: true});
  const result = await labelled.run();
  assert.equal(result.status, 'completed');
  assert.equal(result.photoSubmissionConfirmed, true);
  assert.equal(result.imageCount, 1);
  assert.equal(labelled.clicks(), 1);

  const wrongBody = fixture({prepared: true, labelledQuery: true, wrongUserPrompt: true});
  const mismatch = await wrongBody.run({timeoutMs: 1200});
  assert.equal(mismatch.status, 'needs_attention');
  assert.equal(mismatch.photoSubmissionConfirmed, false);
  assert.equal(wrongBody.clicks(), 1);
});

test('a created conversation is bound once and another chat cannot supply the result', async () => {
  const moved = fixture({prepared: true, navigateAfterBinding: true});
  const result = await moved.run();
  assert.equal(result.status, 'needs_attention');
  assert.equal(moved.clicks(), 1);
  assert.match(result.message, /別の会話/);

  const noConversation = fixture({prepared: true, finalUrl: expectedUrl});
  assert.equal((await noConversation.run()).status, 'needs_attention');
  assert.equal(noConversation.clicks(), 1);
});

test('a different or partial sent prompt is not a confirmed combined submission', async () => {
  const wrongPrompt = fixture({prepared: true, wrongUserPrompt: true});
  const result = await wrongPrompt.run({timeoutMs: 1200});
  assert.equal(result.status, 'needs_attention');
  assert.equal(result.photoSubmissionConfirmed, false);
  assert.equal(wrongPrompt.clicks(), 1);

  const changedInput = fixture({prepared: true});
  assert.equal((await changedInput.run({prompt: `${prompt}\n別の指示`})).status, 'needs_attention');
  assert.equal(changedInput.clicks(), 0);
});

test('a restored sent instruction is cleared after completion while a new user draft is preserved', async () => {
  const restored = fixture({prepared: true, restoredDraft: prompt});
  const completed = await restored.run();
  assert.equal(completed.status, 'completed');
  assert.equal(completed.draftCleared, true);
  assert.equal(restored.draft(), '');
  assert.equal(restored.clicks(), 1);

  const newDraft = fixture({prepared: true, restoredDraft: '次に聞きたい大切な内容'});
  const preserved = await newDraft.run();
  assert.equal(preserved.status, 'completed');
  assert.equal(preserved.draftCleared, false);
  assert.equal(newDraft.draft(), '次に聞きたい大切な内容');
  assert.equal(newDraft.clicks(), 1);

  const pending = fixture({prepared: true, restoredDraft: prompt, outputCount: 0});
  assert.equal((await pending.run({timeoutMs: 1200})).status, 'needs_attention');
  assert.equal(pending.draft(), prompt);
  assert.equal(pending.clicks(), 1);
});

test('multiple generated images or an explicit model error require attention', async () => {
  const multiple = fixture({prepared: true, outputCount: 2});
  const result = await multiple.run();
  assert.equal(result.status, 'needs_attention');
  assert.equal(result.imageCount, 2);
  assert.equal(multiple.clicks(), 1);
  const failed = fixture({prepared: true, responseText: '画像生成の上限に達しました。'});
  assert.equal((await failed.run()).status, 'needs_attention');
  assert.equal(failed.clicks(), 1);
});
