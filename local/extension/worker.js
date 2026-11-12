import { SPELLS } from './quest.js';
import {buildLocalQuestPrompt} from './local-prompt.js';
import {runPhotoDriver} from './photo-driver.js';
import {validatePhoto, conversationUrl} from './photo-contract.js';

const LOCAL_URL = 'http://127.0.0.1:4174/';
const GEMINI_URL = 'https://gemini.google.com/app';
const STORE_KEY = 'crystalQuestJobs';
const running = new Set();
const activeStates = new Set(['opening', 'photo_preparing', 'photo_submitted', 'generating']);
let serial = Promise.resolve();
let writes = Promise.resolve();

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

function mutateJob(requestId, change) {
  const result = writes.then(async () => {
    const jobs = await readJobs();
    const job = change(jobs[requestId]);
    jobs[requestId] = job;
    const entries = Object.entries(jobs).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 20);
    await chrome.storage.session.set({[STORE_KEY]: Object.fromEntries(entries)});
    return job;
  });
  writes = result.catch(() => {});
  return result;
}

function writeJob(job) {return mutateJob(job.requestId, () => job);}
function updateJob(requestId, patch) {
  return mutateJob(requestId, (job) => {
    if (!job) throw new Error('Missing job');
    return {...job, ...(typeof patch === 'function' ? patch(job) : patch), updatedAt: Date.now()};
  });
}

async function currentJob(requestId) {
  let job = (await readJobs())[requestId];
  if (job && activeStates.has(job.status) && !running.has(requestId)) {
    job = await updateJob(requestId, {
      status: 'needs_attention',
      message: job.photoRequestId
        ? '写真の処理が中断されました。既に添付・送信された可能性があるため、自動再送せずGeminiを確認してください。'
        : job.submitAttempted
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

async function executeDriver(tabId, args, func = runPhotoDriver) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func,
    args: [args]
  });
  if (result.length !== 1 || !result[0]?.result) throw new Error('入力画面から応答がありません。');
  return result[0].result;
}

function freshGeminiUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://gemini.google.com' && url.pathname === '/app' && !url.search && !url.hash;
  } catch {return false;}
}

async function assertFreshTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!freshGeminiUrl(tab.url)) throw new Error('Geminiのタブが別の会話へ切り替わっています。自動送信は行いません。');
}

async function assertPhotoTab(job) {
  const expected = conversationUrl(job.url);
  if (!expected || !Number.isInteger(job.tabId)) throw new Error('今回のGeminiチャットを確認できませんでした。');
  const tab = await chrome.tabs.get(job.tabId);
  if (conversationUrl(tab.url) !== expected) throw new Error('Geminiのタブが別の会話へ切り替わっています。');
  return expected;
}

async function runJob(requestId, photo) {
  try {
    const job = (await readJobs())[requestId];
    const tab = await chrome.tabs.create({url: GEMINI_URL, active: true});
    await updateJob(requestId, {tabId: tab.id});
    await waitForLoad(tab.id);
    await assertFreshTab(tab.id);
    await updateJob(requestId, {status: 'photo_preparing', message: '魔法の指示と写真をGeminiに準備しています。'});
    const common = {expectedUrl: GEMINI_URL, prompt: buildLocalQuestPrompt(job.spellId), requestId, photoRequestId: requestId, photoDigest: job.photoDigest};
    const prepared = await executeDriver(tab.id, {...common, photo, phase: 'prepare', timeoutMs: 60_000});
    // Never persist photo bytes; release this reference once attachment ends.
    photo = null;
    if (prepared.status !== 'photo_ready') {
      await updateJob(requestId, {...prepared, status: 'needs_attention'});
      return;
    }
    await assertFreshTab(tab.id);
    // Save the submission boundary before the single click. Any interruption
    // becomes an uncertain result, never an automatic second submission.
    await updateJob(requestId, {status: 'photo_submitted', submitAttempted: true, photoSubmitAttempted: true, message: '魔法の指示と写真をまとめて送信しています。'});
    const result = await executeDriver(tab.id, {...common, phase: 'send', timeoutMs: 240_000});
    const finalTab = await chrome.tabs.get(tab.id);
    const finalUrl = conversationUrl(finalTab.url);
    const verifiedUrl = finalUrl && conversationUrl(result.url) === finalUrl ? finalUrl : null;
    const success = result.status === 'completed' && result.photoSubmissionConfirmed === true && result.imageCount === 1 && verifiedUrl;
    await updateJob(requestId, {...result, url: verifiedUrl, status: success ? 'completed' : 'needs_attention', message: success ? result.message || '戦闘シーン画像が1枚生成されました。Geminiで確認してください。' : result.status === 'completed' ? '生成画像と今回の会話IDの照合を完了できませんでした。Geminiを確認してください。' : result.message || '生成結果を確認できませんでした。自動再送せずGeminiを確認してください。'});
  } catch (error) {
    const job = (await readJobs())[requestId];
    if (job) await updateJob(requestId, {status: 'needs_attention', message: error.message?.includes('別の会話') || error.message?.includes('ログイン') ? error.message : '処理結果を確認できませんでした。既に添付・送信された可能性があるため、自動再送せずGeminiを確認してください。'}).catch(() => {});
  } finally {
    photo = null;
    running.delete(requestId);
  }
}

async function otherJobRunning(requestId) {
  for (const job of Object.values(await readJobs())) {
    if (job.requestId !== requestId && activeStates.has(job.status)) {
      if (running.has(job.requestId)) return true;
      await currentJob(job.requestId);
    }
  }
  return false;
}

async function handleLocal(message, sender) {
  if (message.type === 'HELLO') return { ok: true, version: '1.2.0' };
  if (!validRequestId(message.requestId)) return { ok: false, error: 'リクエストIDが正しくありません。' };
  if (message.type === 'STATUS') {
    const job = await currentJob(message.requestId);
    return job ? { ok: true, job } : { ok: false, error: '実行記録が見つかりません。' };
  }
  if (message.type === 'OPEN_CHAT') {
    const job = await currentJob(message.requestId);
    if (!job) return {ok: false, error: '実行記録が見つかりません。'};
    try {await assertPhotoTab(job); await chrome.tabs.update(job.tabId, {active: true}); return {ok: true, job};}
    catch {return {ok: false, error: '今回のGeminiタブを確認できません。表示された会話リンクから確認してください。'};}
  }
  if (message.type !== 'QUEST_START') return {ok: false, error: '未対応の操作です。ローカル画面を更新してください。'};
  if (!SPELLS.some((spell) => spell.id === message.spellId)) return {ok: false, error: '魔法の指定が正しくありません。'};
  let image;
  try {image = await validatePhoto(message.photo, message.spellId, message.requestId);}
  catch (error) {return {ok: false, error: error.message};}
  const previous = await currentJob(message.requestId);
  if (previous) return previous.spellId === message.spellId && previous.photoDigest === image.metadata.photoDigest ? {ok: true, job: previous} : {ok: false, error: '同じリクエストIDに別の魔法や写真は指定できません。'};
  if (await otherJobRunning(message.requestId)) return {ok: false, error: '別の処理が進行中です。Geminiの結果を確認してください。'};
  const now = Date.now();
  const job = await writeJob({requestId: message.requestId, spellId: message.spellId, launcherTabId: sender.tab.id, photoRequestId: message.requestId, ...image.metadata, status: 'opening', message: 'Geminiを開き、魔法と写真をまとめて送信します。', createdAt: now, updatedAt: now, submitAttempted: false, photoSubmitAttempted: false});
  running.add(job.requestId);
  void runJob(job.requestId, image.photo);
  return {ok: true, job};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.channel === 'crystal-quest-driver' && message.type === 'HEARTBEAT') {
    // Heartbeats keep a pending executeScript job alive. They carry no content,
    // commands or credentials; only the matching running job can advance.
    if (sender.id === chrome.runtime.id && sender.frameId === 0 && /^https:\/\/gemini\.google\.com\/app(?:\/|$)/.test(sender.url || '') && running.has(message.requestId)) {
      void (async () => {
        const job = (await readJobs())[message.requestId];
        if (message.stage === 'generating' && message.photoRequestId === job?.photoRequestId && sender.tab?.id === job?.tabId) {
          await updateJob(message.requestId, (current) => current.status === 'photo_submitted' ? {status: 'generating', message: 'Geminiで戦闘シーンの画像を生成しています。'} : {});
        }
        sendResponse({ok: true});
      })().catch(() => sendResponse({ok: false}));
      return true;
    }
    return false;
  }
  if (message?.channel !== 'crystal-quest-local' || !isLocalSender(sender)) return false;
  serial = serial.then(() => handleLocal(message, sender)).then(sendResponse, () => sendResponse({ ok: false, error: '拡張機能の処理に失敗しました。Geminiを確認してください。' }));
  return true;
});
