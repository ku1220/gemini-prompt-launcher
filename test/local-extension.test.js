import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SPELLS, buildQuestPrompt as buildPublicQuestPrompt, WELCOME_TEXT} from '../dist/quest.js';
import {validatePhoto, conversationUrl} from '../local/extension/photo-contract.js';

const promptContext = vm.createContext({buildQuestPrompt: buildPublicQuestPrompt, WELCOME_TEXT});
new vm.Script((await readFile(new URL('../local/extension/local-prompt.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '')).runInContext(promptContext);
const buildLocalQuestPrompt = promptContext.buildLocalQuestPrompt;
const workerSource = (await readFile(new URL('../local/extension/worker.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const requestId = 'test-request-00000001';
const freshUrl = 'https://gemini.google.com/app';
const resultUrl = `${freshUrl}/test-chat-0001`;
const photoBytes = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]);
const testPhoto = {mime: 'image/jpeg', size: photoBytes.length, name: 'private-original-name.jpg', dataUrl: `data:image/jpeg;base64,${photoBytes.toString('base64')}`};
const localSender = {id: 'test-extension', frameId: 0, url: 'http://127.0.0.1:4174/', tab: {id: 10, url: 'http://127.0.0.1:4174/'}};

function deferred() {
  let resolve;
  const promise = new Promise((done) => {resolve = done;});
  return {promise, resolve};
}

function workerHarness({store = {}, execute, tabUrl} = {}) {
  let listener;
  let currentUrl = freshUrl;
  const calls = {tabs: [], scripts: [], focuses: []};
  const chrome = {
    runtime: {id: localSender.id, onMessage: {addListener(fn) {listener = fn;}}},
    storage: {session: {
      async get(key) {return {[key]: structuredClone(store[key])};},
      async set(value) {Object.assign(store, structuredClone(value));}
    }},
    tabs: {
      async create(options) {calls.tabs.push(options); return {id: calls.tabs.length};},
      async get(id) {return {id, status: 'complete', url: typeof tabUrl === 'function' ? tabUrl(id) : tabUrl || currentUrl};},
      async update(id, options) {calls.focuses.push({id, options}); return {id};}
    },
    scripting: {async executeScript(options) {
      const arg = options.args[0];
      calls.scripts.push({phase: arg.phase, args: arg, storeAtCall: structuredClone(store), target: options.target});
      const result = execute ? await execute(arg, options) : arg.phase === 'prepare' ? {status: 'photo_ready'} : {status: 'completed', photoSubmissionConfirmed: true, imageCount: 1, url: resultUrl};
      if (arg.phase === 'send' && result.url) currentUrl = result.url;
      return [{frameId: 0, result}];
    }}
  };
  const context = vm.createContext({chrome, SPELLS, buildLocalQuestPrompt, validatePhoto, conversationUrl, runPhotoDriver() {}, URL, setTimeout, clearTimeout});
  new vm.Script(workerSource, {filename: 'local/extension/worker.js'}).runInContext(context);
  function dispatch(payload, sender = localSender) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker did not reply')), 2_000);
      const response = (value) => {clearTimeout(timer); resolve(value);};
      const keptOpen = listener({channel: 'crystal-quest-local', ...payload}, structuredClone(sender), response);
      if (!keptOpen) {clearTimeout(timer); resolve(undefined);}
    });
  }
  return {calls, store, context, dispatch, start: (extra = {}) => dispatch({type: 'QUEST_START', spellId: 'ultima', requestId, photo: testPhoto, ...extra}), status: (id = requestId) => dispatch({type: 'STATUS', requestId: id})};
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Worker did not reach expected state');
}

test('local extension accepts only its bridge on the exact top-level local page', async () => {
  const worker = workerHarness();
  assert.equal((await worker.dispatch({type: 'HELLO'})).version, '1.2.0');
  for (const sender of [
    {...localSender, frameId: 1}, {...localSender, id: 'another-extension'},
    {...localSender, url: 'https://example.com/'}, {...localSender, url: 'http://127.0.0.1:9999/'},
    {...localSender, url: 'http://127.0.0.1:4174/other'}, {...localSender, tab: {id: 10, url: 'https://example.com/'}}
  ]) assert.equal(await worker.dispatch({type: 'HELLO'}, sender), undefined);
  assert.equal(worker.calls.tabs.length, 0);
});

test('no tab opens without both a valid spell and a valid photograph', async () => {
  const worker = workerHarness();
  for (const change of [{spellId: 'arbitrary-instruction'}, {requestId: '../secret'}, {photo: undefined}, {photo: {...testPhoto, mime: 'text/html'}}, {photo: {...testPhoto, size: 99}}]) assert.equal((await worker.start(change)).ok, false);
  for (const type of ['START', 'PHOTO_START', 'EXECUTE']) assert.equal((await worker.dispatch({type, requestId, spellId: 'ultima', photo: testPhoto})).ok, false);
  assert.equal(worker.calls.tabs.length, 0);
});

test('one new tab receives the complete spell and photo in a single prepared submission', async () => {
  const worker = workerHarness();
  assert.equal((await worker.start({prompt: 'untrusted replacement', url: 'https://example.com/'})).ok, true);
  await waitFor(async () => (await worker.status()).job.status === 'completed');
  assert.equal(worker.calls.tabs.length, 1);
  assert.equal(worker.calls.tabs[0].url, freshUrl);
  assert.equal(worker.calls.tabs[0].active, true);
  assert.deepEqual(worker.calls.scripts.map((call) => call.phase), ['prepare', 'send']);
  assert.deepEqual(worker.calls.scripts.map((call) => call.target.tabId), [1, 1]);
  for (const call of worker.calls.scripts) {
    assert.equal(call.args.prompt, buildLocalQuestPrompt('ultima'));
    assert.equal(call.args.expectedUrl, freshUrl);
    assert.equal(call.args.photoRequestId, requestId);
  }
  assert.equal(worker.calls.scripts[0].args.photo.dataUrl, testPhoto.dataUrl);
  assert.equal(worker.calls.scripts[1].args.photo, undefined);
  const boundary = worker.calls.scripts[1].storeAtCall.crystalQuestJobs[requestId];
  assert.equal(boundary.submitAttempted, true);
  assert.equal(boundary.photoSubmitAttempted, true);
  assert.equal(boundary.status, 'photo_submitted');
  assert.equal((await worker.status()).job.url, resultUrl);
  assert.equal(worker.calls.focuses.length, 0, 'the flow never returns to the local site');
  const stored = JSON.stringify(worker.store);
  assert.ok(!stored.includes(testPhoto.dataUrl));
  assert.ok(!stored.includes(testPhoto.name));
  assert.ok(!stored.includes(buildLocalQuestPrompt('ultima')));
});

test('duplicate requests are idempotent during attachment and after completion', async () => {
  const gate = deferred();
  const worker = workerHarness({execute: async ({phase}) => phase === 'prepare' ? gate.promise : {status: 'completed', photoSubmissionConfirmed: true, imageCount: 1, url: resultUrl}});
  await worker.start();
  await waitFor(() => worker.calls.scripts.length === 1);
  assert.equal((await worker.start()).ok, true);
  assert.equal(worker.calls.tabs.length, 1);
  assert.equal(worker.calls.scripts.length, 1);
  assert.equal((await worker.start({spellId: 'flare'})).ok, false);
  assert.equal((await worker.start({requestId: 'test-request-00000002'})).ok, false);
  gate.resolve({status: 'photo_ready'});
  await waitFor(async () => (await worker.status()).job.status === 'completed');
  assert.equal((await worker.start()).job.status, 'completed');
  assert.equal(worker.calls.scripts.length, 2);
});

test('the same request ID cannot replace its accepted photograph', async () => {
  const worker = workerHarness();
  await worker.start();
  await waitFor(async () => (await worker.status()).job.status === 'completed');
  const changed = Buffer.concat([photoBytes, Buffer.from([1])]);
  assert.equal((await worker.start({photo: {...testPhoto, size: changed.length, dataUrl: `data:image/jpeg;base64,${changed.toString('base64')}`}})).ok, false);
  assert.equal(worker.calls.tabs.length, 1);
});

test('a restored unfinished job reports uncertainty without reopening or resubmitting', async () => {
  const image = await validatePhoto(testPhoto, 'ultima', requestId);
  const store = {crystalQuestJobs: {[requestId]: {requestId, photoRequestId: requestId, spellId: 'ultima', photoDigest: image.metadata.photoDigest, status: 'photo_submitted', photoSubmitAttempted: true, tabId: 5, createdAt: Date.now()}}};
  const worker = workerHarness({store});
  assert.equal((await worker.status()).job.status, 'needs_attention');
  assert.equal((await worker.start()).job.status, 'needs_attention');
  assert.equal(worker.calls.tabs.length, 0);
  assert.equal(worker.calls.scripts.length, 0);
});

test('prepare failures and uncertain sends never trigger a second attachment or send', async () => {
  for (const failPhase of ['prepare', 'send']) {
    const worker = workerHarness({execute: async ({phase}) => {
      if (phase === failPhase) throw new Error('Interrupted');
      return {status: 'photo_ready'};
    }});
    await worker.start();
    await waitFor(async () => (await worker.status()).job.status === 'needs_attention');
    const before = worker.calls.scripts.length;
    assert.equal((await worker.start()).job.status, 'needs_attention');
    assert.equal(worker.calls.scripts.length, before);
    const restarted = workerHarness({store: structuredClone(worker.store)});
    assert.equal((await restarted.start()).job.status, 'needs_attention');
    assert.equal(restarted.calls.tabs.length, 0);
  }
});

test('login redirects and pre-existing conversation URLs stop before injection', async () => {
  for (const tabUrl of ['https://accounts.google.com/', 'https://gemini.google.com/app/another-chat', `${freshUrl}?draft=1`]) {
    const worker = workerHarness({tabUrl});
    await worker.start();
    await waitFor(async () => (await worker.status()).job.status === 'needs_attention');
    assert.equal(worker.calls.scripts.length, 0);
  }
});

test('a conversation change after attachment prevents the send phase', async () => {
  let tabUrl = freshUrl;
  const worker = workerHarness({tabUrl: () => tabUrl, execute: async () => {tabUrl = `${freshUrl}/another-chat`; return {status: 'photo_ready'};}});
  await worker.start();
  await waitFor(async () => (await worker.status()).job.status === 'needs_attention');
  assert.deepEqual(worker.calls.scripts.map((call) => call.phase), ['prepare']);
});

test('completion requires one image, a confirmed combined message and the same resulting conversation', async () => {
  for (const result of [
    {imageCount: 0, photoSubmissionConfirmed: true, url: resultUrl},
    {imageCount: 2, photoSubmissionConfirmed: true, url: resultUrl},
    {imageCount: 1, photoSubmissionConfirmed: false, url: resultUrl},
    {imageCount: 1, photoSubmissionConfirmed: true, url: freshUrl},
    {imageCount: 1, photoSubmissionConfirmed: true, url: 'https://evil.example/app/chat'}
  ]) {
    const worker = workerHarness({execute: async ({phase}) => phase === 'prepare' ? {status: 'photo_ready'} : {status: 'completed', ...result}});
    await worker.start();
    await waitFor(async () => (await worker.status()).job.status === 'needs_attention');
  }
  const changed = workerHarness({tabUrl: (id) => changed.calls.scripts.length < 2 ? freshUrl : `${freshUrl}/different-chat`});
  await changed.start();
  await waitFor(async () => (await changed.status()).job.status === 'needs_attention');
});
