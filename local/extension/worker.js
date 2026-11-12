import { SPELLS, buildQuestPrompt, WELCOME_TEXT } from './quest.js';
import { runGeminiDriver } from './gemini-driver.js';

const LOCAL_URL = 'http://127.0.0.1:4174/';
const GEMINI_URL = 'https://gemini.google.com/app';
const STORE_KEY = 'crystalQuestJobs';
const running = new Set();
const activeStates = new Set(['opening', 'filling', 'submitted']);
let serial = Promise.resolve();

// The bridge is injected only on loopback, and this rejects other ports,
// paths, iframes and extension senders as well. No externally_connectable API.
export function isLocalSender(sender, extensionId = chrome.runtime.id) {
  return sender?.id === extensionId && sender.frameId === 0 && sender.url === LOCAL_URL && sender.tab?.url === LOCAL_URL;
}

function validRequestId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
}

async function readJobs() {
  return (await chrome.storage.session.get(STORE_KEY))[STORE_KEY] || {};
}

async function writeJob(job) {
  const jobs = await readJobs();
  jobs[job.requestId] = job;
  const entries = Object.entries(jobs).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 20);
  await chrome.storage.session.set({ [STORE_KEY]: Object.fromEntries(entries) });
  return job;
}

async function updateJob(requestId, patch) {
  const job = (await readJobs())[requestId];
  if (!job) throw new Error('Missing job');
  return writeJob({ ...job, ...patch, updatedAt: Date.now() });
}

async function currentJob(requestId) {
  let job = (await readJobs())[requestId];
  if (job && activeStates.has(job.status) && !running.has(requestId)) {
    job = await updateJob(requestId, {
      status: 'needs_attention',
      message: job.submitAttempted
        ? '拡張機能の実行が中断されました。送信された可能性があるため、自動再送せずGeminiを確認してください。'
        : '拡張機能の実行が中断されました。開いたGeminiを確認してください。'
    });
  }
  return job;
}

async function waitForLoad(tabId, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') {
      const url = new URL(tab.url || 'about:blank');
      if (url.origin !== 'https://gemini.google.com' || !/^\/app(?:\/|$)/.test(url.pathname)) {
        throw new Error('GeminiへのログインをChromeで確認してください。');
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Geminiの読み込みを確認できませんでした。');
}

async function executeDriver(tabId, args) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: runGeminiDriver,
    args: [args]
  });
  if (result.length !== 1 || !result[0]?.result) throw new Error('入力画面から応答がありません。');
  return result[0].result;
}

async function runJob(requestId) {
  try {
    const job = (await readJobs())[requestId];
    const prompt = buildQuestPrompt(job.spellId);
    const tab = await chrome.tabs.create({ url: GEMINI_URL, active: true });
    await updateJob(requestId, { tabId: tab.id });
    await waitForLoad(tab.id);
    await updateJob(requestId, { status: 'filling', message: 'Geminiにプロンプト全文を入力しています。' });
    const common = { prompt, welcome: WELCOME_TEXT, requestId };
    const prepared = await executeDriver(tab.id, { ...common, phase: 'prepare', timeoutMs: 45_000 });
    if (prepared.status !== 'ready') {
      await updateJob(requestId, prepared);
      return;
    }

    // Persist the irreversible boundary first. If the worker is interrupted,
    // STATUS reports uncertainty; neither START nor recovery submits again.
    await updateJob(requestId, {
      status: 'submitted',
      submitAttempted: true,
      message: '送信操作を実行しています。歓迎文の表示を確認するまで再送しないでください。'
    });
    const result = await executeDriver(tab.id, { ...common, phase: 'send', timeoutMs: 90_000 });
    const finalTab = await chrome.tabs.get(tab.id);
    const finalUrl = /^https:\/\/gemini\.google\.com\/app(?:\/|$)/.test(finalTab.url || '') ? finalTab.url : GEMINI_URL;
    await updateJob(requestId, {...result, url: finalUrl});
  } catch (error) {
    const job = (await readJobs())[requestId];
    if (job) await updateJob(requestId, {
      status: 'needs_attention',
      message: job.submitAttempted
        ? '送信結果を確認できませんでした。自動再送せず、開いたGeminiを確認してください。'
        : error.message === 'GeminiへのログインをChromeで確認してください。' ? error.message : 'Geminiを操作できませんでした。開いたタブとログイン状態を確認してください。'
    });
  } finally {
    running.delete(requestId);
  }
}

async function handleLocal(message) {
  if (message.type === 'HELLO') return { ok: true, version: '1.0.0' };
  if (!validRequestId(message.requestId)) return { ok: false, error: 'リクエストIDが正しくありません。' };
  if (message.type === 'STATUS') {
    const job = await currentJob(message.requestId);
    return job ? { ok: true, job } : { ok: false, error: '実行記録が見つかりません。' };
  }
  if (message.type !== 'START') return { ok: false, error: '未対応の操作です。' };
  if (!SPELLS.some((spell) => spell.id === message.spellId)) return { ok: false, error: '魔法の指定が正しくありません。' };
  const previous = await currentJob(message.requestId);
  if (previous) return previous.spellId === message.spellId ? { ok: true, job: previous } : { ok: false, error: '同じリクエストIDは別の魔法には使えません。' };
  const jobs = await readJobs();
  for (const old of Object.values(jobs)) {
    if (activeStates.has(old.status)) {
      if (running.has(old.requestId)) return { ok: false, error: '別のクエストを準備中です。先に開いたGeminiを確認してください。' };
      await currentJob(old.requestId);
    }
  }
  const now = Date.now();
  const job = await writeJob({ requestId: message.requestId, spellId: message.spellId, status: 'opening', message: '新しいGeminiのチャットを開いています。', createdAt: now, updatedAt: now, submitAttempted: false });
  running.add(job.requestId);
  // Return immediately so the local UI can poll while this job runs.
  void runJob(job.requestId);
  return { ok: true, job };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.channel === 'crystal-quest-driver' && message.type === 'HEARTBEAT') {
    // Heartbeats keep a pending executeScript job alive. They carry no content,
    // commands or credentials and cannot change any job state.
    if (sender.id === chrome.runtime.id && sender.frameId === 0 && /^https:\/\/gemini\.google\.com\/app(?:\/|$)/.test(sender.url || '') && running.has(message.requestId)) {
      sendResponse({ ok: true });
    }
    return false;
  }
  if (message?.channel !== 'crystal-quest-local' || !isLocalSender(sender)) return false;
  serial = serial.then(() => handleLocal(message)).then(sendResponse, () => sendResponse({ ok: false, error: '拡張機能の処理に失敗しました。Geminiを確認してください。' }));
  return true;
});
