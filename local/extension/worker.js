import { SPELLS } from './quest.js';
import {buildLocalQuestPrompt as buildQuestPrompt, LOCAL_WELCOME_TEXT as WELCOME_TEXT} from './local-prompt.js';
import { runGeminiDriver } from './gemini-driver.js';
import {runPhotoDriver} from './photo-driver.js';
import {validatePhoto, conversationUrl} from './photo-contract.js';

const LOCAL_URL = 'http://127.0.0.1:4174/';
const GEMINI_URL = 'https://gemini.google.com/app';
const STORE_KEY = 'crystalQuestJobs';
const running = new Set();
const activeStates = new Set(['opening', 'filling', 'submitted', 'photo_preparing', 'photo_submitted', 'generating']);
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

async function executeDriver(tabId, args, func = runGeminiDriver) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func,
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
    const finalUrl = conversationUrl(finalTab.url);
    if (result.status === 'completed' && result.submissionConfirmed && result.welcomeMatched && finalUrl) {
      await updateJob(requestId, {...result, status: 'awaiting_photo', url: finalUrl, message: '冒険の準備ができました。ローカル画面で撮影し、「この写真で生成」を押してください。'});
      // Return only while our Gemini tab is still active; do not steal focus
      // if the user has moved to an unrelated tab while waiting.
      if (finalTab.active && job.launcherTabId) await chrome.tabs.update(job.launcherTabId, {active: true}).catch(() => {});
    } else {
      await updateJob(requestId, {...result, status: result.status === 'completed' ? 'needs_attention' : result.status, url: finalUrl, message: result.status === 'completed' ? '歓迎文と会話IDの確認を完了できませんでした。Geminiを確認してください。' : result.message});
    }
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

async function assertPhotoTab(job) {
  const expected = conversationUrl(job.url);
  if (!expected || !Number.isInteger(job.tabId)) throw new Error('準備済みのGeminiチャットを確認できませんでした。');
  const tab = await chrome.tabs.get(job.tabId);
  if (conversationUrl(tab.url) !== expected) throw new Error('Geminiのタブが別の会話へ切り替わっています。写真は送信していません。');
  return expected;
}

async function runPhotoJob(requestId, photo) {
  try {
    const job = (await readJobs())[requestId];
    const expectedUrl = await assertPhotoTab(job);
    await chrome.tabs.update(job.tabId, {active: true});
    const common = {expectedUrl, prompt: buildQuestPrompt(job.spellId), welcome: WELCOME_TEXT, requestId, photoRequestId: job.photoRequestId, photoDigest: job.photoDigest};
    const prepared = await executeDriver(job.tabId, {...common, photo, phase: 'prepare', timeoutMs: 60_000}, runPhotoDriver);
    // Drop the only worker-held image reference as soon as attachment ends.
    photo = null;
    if (prepared.status !== 'photo_ready') {
      await updateJob(requestId, {...prepared, status: 'needs_attention'});
      return;
    }
    await assertPhotoTab(job);
    await updateJob(requestId, {status: 'photo_submitted', photoSubmitAttempted: true, message: '写真を送信しています。生成結果を確認するまで再送しないでください。'});
    const result = await executeDriver(job.tabId, {...common, phase: 'send', timeoutMs: 240_000}, runPhotoDriver);
    const success = result.status === 'completed' && result.photoSubmissionConfirmed === true && result.imageCount === 1;
    await updateJob(requestId, {...result, status: success ? 'completed' : 'needs_attention', message: result.message || (success ? '戦闘シーン画像が1枚生成されました。Geminiで確認してください。' : '写真送信後の生成結果を確認できませんでした。Geminiを確認してください。')});
  } catch (error) {
    await updateJob(requestId, {status: 'needs_attention', message: error.message?.includes('別の会話') ? error.message : '写真の処理結果を確認できませんでした。既に添付・送信された可能性があるため、Geminiを確認してください。自動再送は行いません。'}).catch(() => {});
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
  if (message.type === 'HELLO') return { ok: true, version: '1.1.0' };
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
  if (message.type === 'PHOTO_START') {
    if (!validRequestId(message.photoRequestId)) return {ok: false, error: '写真のリクエストIDが正しくありません。'};
    const job = await currentJob(message.requestId);
    if (!job) return {ok: false, error: '先に魔法を選んで冒険を開始してください。'};
    if (job.photoRequestId && job.photoRequestId !== message.photoRequestId) return {ok: false, error: 'この冒険への写真送信は既に開始されています。再添付せず、Geminiを確認してください。'};
    if (!job.photoRequestId && (job.status !== 'awaiting_photo' || !job.welcomeMatched || !job.submissionConfirmed)) return {ok: false, error: 'Geminiの準備が完了していません。歓迎文が表示されるまでお待ちください。'};
    let image;
    try {image = await validatePhoto(message.photo, job.spellId, message.photoRequestId);}
    catch (error) {return {ok: false, error: error.message};}
    if (job.photoRequestId) return job.photoDigest === image.metadata.photoDigest ? {ok: true, job} : {ok: false, error: '同じ写真リクエストIDに別の画像は指定できません。'};
    if (running.has(job.requestId) || await otherJobRunning(job.requestId)) return {ok: false, error: '別の処理が進行中です。Geminiの結果を確認してください。'};
    try {await assertPhotoTab(job);} catch (error) {return {ok: false, error: error.message};}
    const next = await updateJob(job.requestId, {status: 'photo_preparing', photoRequestId: message.photoRequestId, ...image.metadata, photoSubmitAttempted: false, message: '今回のGeminiチャットへ写真を添付しています。'});
    running.add(job.requestId);
    void runPhotoJob(job.requestId, image.photo);
    return {ok: true, job: next};
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
  const job = await writeJob({ requestId: message.requestId, spellId: message.spellId, launcherTabId: sender.tab.id, status: 'opening', message: '新しいGeminiのチャットを開いています。', createdAt: now, updatedAt: now, submitAttempted: false });
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
