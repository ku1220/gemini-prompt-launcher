import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SPELLS, buildQuestPrompt, WELCOME_TEXT } from '../dist/quest.js';

const workerSource = (await readFile(new URL('../local/extension/worker.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replace(/^export /gm, '');
const driverSource = (await readFile(new URL('../local/extension/gemini-driver.js', import.meta.url), 'utf8'))
  .replace(/^export /gm, '');
const requestId = 'test-request-00000001';
const localSender = {
  id: 'test-extension', frameId: 0,
  url: 'http://127.0.0.1:4174/',
  tab: { id: 10, url: 'http://127.0.0.1:4174/' }
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function workerHarness({ store = {}, execute, tabUrl = 'https://gemini.google.com/app' } = {}) {
  let listener;
  const calls = { tabs: [], scripts: [] };
  const chrome = {
    runtime: { id: localSender.id, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { session: {
      async get(key) { return { [key]: structuredClone(store[key]) }; },
      async set(value) { Object.assign(store, structuredClone(value)); }
    } },
    tabs: {
      async create(options) { calls.tabs.push(options); return { id: calls.tabs.length }; },
      async get(id) { return { id, status: 'complete', url: tabUrl }; }
    },
    scripting: { async executeScript(options) {
      const arg = options.args[0];
      calls.scripts.push({ phase: arg.phase, args: arg, storeAtCall: structuredClone(store), target: options.target });
      const result = execute
        ? await execute(arg, options)
        : arg.phase === 'prepare' ? { status: 'ready' } : { status: 'completed', submissionConfirmed: true, welcomeMatched: true };
      return [{ frameId: 0, result }];
    } }
  };
  const context = vm.createContext({ chrome, SPELLS, buildQuestPrompt, WELCOME_TEXT, runGeminiDriver() {}, URL, setTimeout, clearTimeout, console });
  new vm.Script(workerSource, { filename: 'local/extension/worker.js' }).runInContext(context);
  function dispatch(payload, sender = localSender) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker did not reply')), 2_000);
      const response = (value) => { clearTimeout(timer); resolve(value); };
      const keptOpen = listener({ channel: 'crystal-quest-local', ...payload }, structuredClone(sender), response);
      if (!keptOpen) { clearTimeout(timer); resolve(undefined); }
    });
  }
  const start = (extra = {}) => dispatch({ type: 'START', spellId: 'ultima', requestId, ...extra });
  const status = (id = requestId) => dispatch({ type: 'STATUS', requestId: id });
  return { calls, store, context, dispatch, start, status };
}

async function waitFor(check, message = 'Worker did not reach expected state') {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

test('local extension accepts only its bridge in the exact top-level local page', async () => {
  const worker = workerHarness();
  assert.equal((await worker.dispatch({ type: 'HELLO' })).ok, true);
  for (const sender of [
    { ...localSender, frameId: 1 },
    { ...localSender, id: 'another-extension' },
    { ...localSender, url: 'https://example.com/' },
    { ...localSender, url: 'http://127.0.0.1:9999/' },
    { ...localSender, url: 'http://127.0.0.1:4174/other' },
    { ...localSender, tab: { id: 10, url: 'https://example.com/' } }
  ]) assert.equal(await worker.dispatch({ type: 'HELLO' }, sender), undefined);
  assert.equal(worker.calls.tabs.length, 0);
});

test('invalid spell, request ID and arbitrary command cannot start a tab', async () => {
  const worker = workerHarness();
  assert.equal((await worker.start({ spellId: 'arbitrary-instruction' })).ok, false);
  assert.equal((await worker.start({ requestId: '../secret' })).ok, false);
  assert.equal((await worker.dispatch({ type: 'EXECUTE', requestId, prompt: 'anything', url: 'https://example.com/' })).ok, false);
  assert.equal(worker.calls.tabs.length, 0);
});

test('duplicate start is idempotent and submit boundary is saved before send', async () => {
  const worker = workerHarness();
  assert.equal((await worker.start({ prompt: 'untrusted replacement', url: 'https://example.com/' })).ok, true);
  assert.equal((await worker.start()).ok, true);
  await waitFor(async () => (await worker.status()).job.status === 'completed');
  assert.equal((await worker.start()).job.status, 'completed');
  assert.equal(worker.calls.tabs.length, 1);
  assert.equal(worker.calls.tabs[0].url, 'https://gemini.google.com/app');
  assert.equal(worker.calls.tabs[0].active, true);
  assert.deepEqual(worker.calls.scripts.map((call) => call.phase), ['prepare', 'send']);
  for (const call of worker.calls.scripts) {
    assert.equal(call.args.prompt, buildQuestPrompt('ultima'));
    assert.equal(call.args.welcome, WELCOME_TEXT);
  }
  const boundary = worker.calls.scripts[1].storeAtCall.crystalQuestJobs[requestId];
  assert.equal(boundary.submitAttempted, true);
  assert.equal(boundary.status, 'submitted');
  assert.equal((await worker.start({ spellId: 'flare' })).ok, false);
});

test('different request cannot run while first job is preparing', async () => {
  const gate = deferred();
  const worker = workerHarness({ execute: async ({ phase }) => phase === 'prepare' ? gate.promise : { status: 'completed' } });
  await worker.start();
  await waitFor(() => worker.calls.scripts.length === 1);
  const blocked = await worker.start({ requestId: 'test-request-00000002', spellId: 'flare' });
  assert.equal(blocked.ok, false);
  assert.equal(worker.calls.tabs.length, 1);
  gate.resolve({ status: 'ready' });
  await waitFor(async () => (await worker.status()).job.status === 'completed');
});

test('worker restart reports uncertain prior submission and does not reopen or resubmit', async () => {
  const store = { crystalQuestJobs: { [requestId]: {
    requestId, spellId: 'ultima', status: 'submitted', submitAttempted: true, tabId: 5, createdAt: Date.now()
  } } };
  const worker = workerHarness({ store });
  const status = await worker.status();
  assert.equal(status.job.status, 'needs_attention');
  assert.equal(status.job.submitAttempted, true);
  assert.equal((await worker.start()).job.status, 'needs_attention');
  assert.equal(worker.calls.tabs.length, 0);
  assert.equal(worker.calls.scripts.length, 0);
});

test('failed prepare never sends, and failed send is never retried', async () => {
  const prepareWorker = workerHarness({ execute: async () => ({ status: 'needs_attention', message: '入力全文が一致しません。' }) });
  await prepareWorker.start();
  await waitFor(async () => (await prepareWorker.status()).job.status === 'needs_attention');
  assert.deepEqual(prepareWorker.calls.scripts.map((call) => call.phase), ['prepare']);
  const sendWorker = workerHarness({ execute: async ({ phase }) => {
    if (phase === 'prepare') return { status: 'ready' };
    throw new Error('Tab disappeared after click');
  } });
  await sendWorker.start();
  await waitFor(async () => (await sendWorker.status()).job.status === 'needs_attention');
  assert.equal((await sendWorker.start()).job.status, 'needs_attention');
  assert.deepEqual(sendWorker.calls.scripts.map((call) => call.phase), ['prepare', 'send']);
  assert.equal(sendWorker.calls.tabs.length, 1);
});

test('login redirect is reported without injecting a driver into another origin', async () => {
  const worker = workerHarness({ tabUrl: 'https://accounts.google.com/' });
  await worker.start();
  await waitFor(async () => (await worker.status()).job.status === 'needs_attention');
  assert.equal(worker.calls.scripts.length, 0);
});

function driverHarness({ responseText = '指定と異なる返答', extraResponseText, hasImage = false, editorText = buildQuestPrompt('ultima'), url = 'https://gemini.google.com/app' } = {}) {
  let clicked = 0;
  const node = (innerText = '') => ({ innerText, isConnected: true, getClientRects: () => [{}], getAttribute: () => null, contains: () => false });
  const editor = { ...node(editorText), value: editorText, focus() {} };
  const bubble = node(buildQuestPrompt('ultima'));
  const response = node(responseText);
  const extraResponse = extraResponseText ? node(extraResponseText) : null;
  const button = { ...node(), disabled: false, click() { clicked++; } };
  const root = { querySelectorAll(selector) {
    if (selector.startsWith('textarea')) return [editor];
    if (selector === 'user-query' || selector === '[data-test-id="user-query"]') return clicked ? [bubble] : [];
    if (['model-response .markdown', 'model-response .model-response-text', '[data-test-id="model-response"] .markdown'].includes(selector)) return clicked ? [response, ...(extraResponse ? [extraResponse] : [])] : [];
    if (selector === 'model-response img') return clicked && hasImage ? [node()] : [];
    if (selector === 'button[aria-label="送信"]') return [button];
    return [];
  } };
  const context = vm.createContext({
    document: { querySelector: () => root, body: root },
    location: new URL(url), window: {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setInterval, clearInterval, setTimeout, Date,
    chrome: { runtime: { sendMessage: async () => ({ ok: true }) } }
  });
  context.window.top = context.window;
  new vm.Script(driverSource, { filename: 'local/extension/gemini-driver.js' }).runInContext(context);
  return { context, clicks: () => clicked, run: (extra = {}) => context.runGeminiDriver({ phase: 'send', prompt: buildQuestPrompt('ultima'), welcome: WELCOME_TEXT, requestId, timeoutMs: 100, ...extra }) };
}

test('actual driver cannot report completion for a mismatched welcome and clicks only once', async () => {
  const driver = driverHarness();
  const result = await driver.run();
  assert.equal(result.status, 'needs_attention');
  assert.equal(result.submissionConfirmed, true);
  assert.equal(result.welcomeMatched, false);
  assert.equal(driver.clicks(), 1);
});

test('actual driver will not send changed prompt or a non-Gemini page', async () => {
  const changed = driverHarness({ editorText: 'User changed the message' });
  assert.equal((await changed.run()).status, 'needs_attention');
  assert.equal(changed.clicks(), 0);
  const otherOrigin = driverHarness({ url: 'https://example.com/app' });
  assert.equal((await otherOrigin.run()).status, 'needs_attention');
  assert.equal(otherOrigin.clicks(), 0);
});

test('actual driver confirms a matching model welcome after one submission', async () => {
  const driver = driverHarness({responseText: WELCOME_TEXT});
  const result = await driver.run({timeoutMs: 2400});
  assert.equal(result.status, 'completed');
  assert.equal(result.submissionConfirmed, true);
  assert.equal(result.welcomeMatched, true);
  assert.equal(driver.clicks(), 1);
});

test('welcome plus extra model text or an image is not a welcome-only success', async () => {
  for (const additions of [{extraResponseText: '余計な返答'}, {hasImage: true}]) {
    const driver = driverHarness({responseText: WELCOME_TEXT, ...additions});
    const result = await driver.run();
    assert.equal(result.status, 'needs_attention');
    assert.equal(result.welcomeMatched, false);
    assert.equal(driver.clicks(), 1);
  }
});

test('Gemini collapsing blank paragraphs does not discard the prompt', async () => {
  const driver = driverHarness({editorText: buildQuestPrompt('ultima').replace(/\n+/g, '\n'), responseText: WELCOME_TEXT});
  const result = await driver.run({timeoutMs: 2400});
  assert.equal(result.status, 'completed');
  assert.equal(driver.clicks(), 1);
});

test('prepare reuses only a restored draft that matches the entire selected quest', async () => {
  const sameQuest = driverHarness({editorText: buildQuestPrompt('ultima').replace(/\n+/g, '\n')});
  assert.equal((await sameQuest.run({phase: 'prepare'})).status, 'ready');
  assert.equal(sameQuest.clicks(), 0);
  for (const text of ['未送信のユーザーの下書き', buildQuestPrompt('flare'), buildQuestPrompt('ultima').slice(0, -40)]) {
    const otherDraft = driverHarness({editorText: text});
    assert.equal((await otherDraft.run({phase: 'prepare'})).status, 'needs_attention');
    assert.equal(otherDraft.clicks(), 0);
  }
});
