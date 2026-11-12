import {SPELLS, getSpell} from '/assets/quest.js';
import {buildLocalQuestPrompt as buildQuestPrompt} from '/assets/local-prompt.js';
import {CameraCapture} from './camera.js';

const $ = (id) => document.getElementById(id);
const channel = 'crystal-quest-local';
const terminal = new Set(['completed', 'failed', 'needs_attention']);
const processing = new Set(['opening', 'photo_preparing', 'photo_submitted', 'generating']);
let selectedId = 'ultima';
let connected = false;
let busy = false;
// The attempt ID is saved before dispatch; never persist photo bytes or retry
// an uncertain request after reload. Capturing alone creates no request.
let currentId = sessionStorage.getItem('quest-local-request') || null;
let currentJob = null;
let restoring = Boolean(currentId);
let pollTimer;
let polling = false;
let cameraErrorText = '';
let previewReady = false;
let previewErrorText = '';
const pending = new Map();
const symbols = ['✧', '✹', '✦', 'ϟ', '❄', '☄'];

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.channel !== channel || data.direction !== 'response') return;
  pending.get(data.rpcId)?.(data.response);
});

function rpc(type, data = {}) {
  return new Promise((resolve) => {
    const rpcId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(rpcId);
      resolve({ok: false, transportFailure: true, error: '拡張機能から応答がありません。Chromeでこのページを開き、拡張機能の更新と接続を確認してください。'});
    }, type === 'QUEST_START' ? 10_000 : 4000);
    pending.set(rpcId, (result) => {clearTimeout(timer); pending.delete(rpcId); resolve(result);});
    window.postMessage({channel, direction: 'request', rpcId, type, ...data}, location.origin);
  });
}

function readyForPhoto() {return connected && !busy && !restoring && !currentId;}

const camera = new CameraCapture({
  video: $('camera-video'), canvas: $('camera-canvas'),
  onState({state, message, devices, deviceId}) {
    cameraErrorText = state === 'error' ? message : '';
    if (devices) {
      $('camera-device').replaceChildren(new Option('自動選択', ''));
      devices.forEach((device, index) => $('camera-device').add(new Option(device.label || `カメラ ${index + 1}`, device.deviceId)));
      if (deviceId) $('camera-device').value = deviceId;
    }
    renderCamera();
  },
  onPhoto(photo) {
    previewReady = false;
    previewErrorText = '';
    if (photo && camera.previewUrl) $('photo-preview').src = camera.previewUrl;
    else $('photo-preview').removeAttribute('src');
    renderCamera();
  },
});
$('photo-preview').addEventListener('load', () => {
  if ($('photo-preview').src === camera.previewUrl && $('photo-preview').naturalWidth > 0) {previewReady = true; renderCamera();}
});
$('photo-preview').addEventListener('error', () => {
  if (camera.photo) {previewReady = false; previewErrorText = '写真のプレビューを表示できませんでした。撮り直すか、別の写真を選んでください。'; renderCamera();}
});

function renderCamera() {
  const ready = readyForPhoto();
  const working = ['requesting', 'capturing'].includes(camera.state);
  $('capture-stage').dataset.cameraState = camera.state;
  $('camera-video').hidden = camera.state !== 'live';
  $('photo-preview').hidden = !camera.photo;
  $('camera-placeholder').hidden = camera.state === 'live' || Boolean(camera.photo);
  $('camera-placeholder').querySelector('small').textContent = camera.state === 'requesting' ? 'カメラの使用許可を待っています。' : camera.state === 'capturing' ? '写真を準備しています。' : ready ? 'カメラを起動するか、保存済みの写真を選んでください。' : '拡張機能への接続を確認してください。';
  $('camera-start').hidden = camera.state === 'live' || Boolean(camera.photo);
  $('camera-start').disabled = !ready || working;
  $('capture').hidden = Boolean(camera.photo);
  $('capture').disabled = !ready || camera.state !== 'live';
  $('retake').hidden = !camera.photo;
  $('retake').disabled = !ready || working;
  $('choose-photo').disabled = !ready || working;
  $('photo-file').disabled = !ready || working;
  $('camera-device').disabled = !ready || working || Boolean(camera.photo);
  $('send-photo').disabled = !ready || !camera.photo || !camera.previewUrl || !previewReady || camera.state !== 'photo';
  $('send-photo').textContent = busy || restoring ? '画像を生成しています…' : currentId ? 'この写真の送信は終了しています' : 'この写真で生成';
  let message;
  if (previewErrorText && ready) message = previewErrorText;
  else if (camera.state === 'error' && ready) message = cameraErrorText;
  else if (processing.has(currentJob?.status)) message = '選んだ魔法の指示と写真をまとめてGeminiへ送り、画像生成の完了を待っています。';
  else if (currentJob?.status === 'completed') message = 'Geminiで画像の生成を確認しました。新しい冒険では、別の写真や魔法を使えます。';
  else if (currentId) message = 'この冒険では送信を開始済みです。重複送信を避けるため、Geminiの結果を確認してください。';
  else if (!ready) message = 'Chrome拡張機能に接続すると、この画面で写真を用意できます。';
  else if (camera.state === 'requesting') message = 'カメラの使用許可を待っています。許可すると、この画面にプレビューが表示されます。';
  else if (camera.state === 'capturing') message = '写真のプレビューを準備しています。';
  else if (camera.state === 'live') message = 'あなたとまものが写るように構え、「この瞬間を撮影」を押してください。';
  else if (camera.photo) message = `「${getSpell(selectedId).name}」で生成する写真を確認し、よければ「この写真で生成」を押してください。`;
  else message = '選んだ魔法で冒険の一枚を。「カメラを起動」または「保存済みの写真を選ぶ」から写真を用意してください。';
  $('camera-message').textContent = message;
  $('camera-message').dataset.error = String(camera.state === 'error' || Boolean(previewErrorText));
  $('photo-step').textContent = currentJob?.status === 'completed' ? '画像ができました' : busy || restoring ? 'Geminiで画像を生成中' : currentId ? 'Geminiの結果を確認' : `選択中の魔法：${getSpell(selectedId).name}`;
}

function updateButton() {
  const locked = busy || restoring || Boolean(currentId);
  $('start').disabled = !connected || locked;
  $('start').textContent = !connected ? '拡張機能を追加・更新してください' : currentJob?.status === 'completed' ? '冒険の一枚ができました' : locked ? 'Geminiの結果を確認してください' : camera.photo ? '下の写真を確認して生成' : `${getSpell(selectedId).name}で写真を撮る`;
  document.querySelectorAll('input[name=spell]').forEach((input) => {input.disabled = locked;});
  $('reset').hidden = !currentJob || !terminal.has(currentJob.status);
  $('reset').disabled = busy || restoring;
  $('reset').textContent = currentJob?.status === 'needs_attention' ? 'Geminiを確認したので、新しい冒険を準備する' : '新しい冒険を準備する';
  renderCamera();
}

function renderSpell() {
  const spell = getSpell(selectedId);
  $('spell-name').textContent = spell.name;
  $('spell-description').textContent = spell.description;
  $('prompt').value = buildQuestPrompt(selectedId);
  updateButton();
}

SPELLS.forEach((spell, index) => {
  const label = document.createElement('label');
  label.className = 'spell-option';
  label.style.setProperty('--spell-color', ['#b6b9ff', '#f3ab79', '#e9dbaf', '#cab5f3', '#91d8ec', '#d9ac8d'][index]);
  const radio = document.createElement('input');
  Object.assign(radio, {type: 'radio', name: 'spell', value: spell.id, checked: spell.id === selectedId});
  const card = document.createElement('span');
  card.className = 'spell-card';
  for (const [className, tag, text] of [['spell-check', 'span', '✓'], ['spell-symbol', 'span', symbols[index]], ['spell-english', 'span', spell.english], ['', 'strong', spell.name], ['spell-element', 'span', '写真から、魔法の世界へ']]) {
    const part = document.createElement(tag); part.className = className; part.textContent = text; card.append(part);
  }
  radio.addEventListener('change', () => {if (radio.checked && !currentId && !busy && !restoring) {selectedId = spell.id; renderSpell();}});
  label.append(radio, card); $('spells').append(label);
});

function notice(title, detail, state = '') {
  $('run-title').textContent = title;
  $('run-detail').textContent = detail;
  $('run-title').parentElement.dataset.state = state;
}

function showJob(job) {
  if (!job || (currentJob?.updatedAt && job.updatedAt && job.updatedAt < currentJob.updatedAt)) return busy;
  if (!processing.has(job.status) && !terminal.has(job.status)) {
    uncertain('旧バージョンの冒険は継続できません。開いているGeminiを確認して、新しい冒険を準備してください。');
    return false;
  }
  currentJob = {...job};
  const state = currentJob.status;
  busy = processing.has(state);
  const spell = getSpell(job.spellId);
  selectedId = spell.id;
  document.querySelector(`input[value="${spell.id}"]`).checked = true;
  if (['live', 'requesting', 'capturing'].includes(camera.state)) camera.stop();
  renderSpell();
  const texts = {
    opening: ['Geminiを開いています。', '新しいチャットへ魔法の指示と写真をまとめて送ります。'],
    photo_preparing: ['魔法の指示と写真を準備しています。', '写真の添付とプロンプト全文を確認しています。'],
    photo_submitted: ['指示と写真を送信しています。', '送信操作とGeminiの受信を確認しています。自動で再送することはありません。'],
    generating: ['Geminiで画像を生成しています。', '今回のチャットを閉じずにお待ちください。そのチャットに完成画像が表示されます。'],
    completed: ['冒険の一枚ができました。', 'Geminiで画像の生成を確認しました。「今回のGeminiを開く」から画像を確認できます。'],
    needs_attention: ['Geminiの画面を確認してください。', '処理結果を確定できませんでした。重複送信を避けるため、自動で再送することはありません。'],
    failed: ['準備を完了できませんでした。', 'Geminiのログインや画面の状態を確認してください。'],
  };
  const [title, detail] = texts[state];
  notice(title, job.message || detail, state);
  if (typeof job.url === 'string' && /^https:\/\/gemini\.google\.com\/app(?:\/[^?#]*)?(?:[?#].*)?$/.test(job.url)) {
    $('chat-link').href = job.url; $('chat-link').hidden = false;
  } else $('chat-link').hidden = true;
  return busy;
}

function uncertain(message) {
  busy = false; restoring = false;
  currentJob = {...(currentJob || {spellId: selectedId}), status: 'needs_attention'};
  camera.stop(); updateButton();
  notice('Geminiの画面を確認してください。', `${message} 送信済みの可能性があるため、自動再送は行いません。`, 'needs_attention');
}

async function poll() {
  clearTimeout(pollTimer);
  if (!currentId || polling) return;
  polling = true;
  const id = currentId;
  try {
    const result = await rpc('STATUS', {requestId: id});
    if (id !== currentId) return;
    restoring = false;
    if (!result?.ok) {uncertain(result?.error || '処理状況を確認できません。'); return;}
    if (showJob(result.job)) pollTimer = setTimeout(poll, 1300);
  } finally {polling = false;}
}

async function connect() {
  $('check').disabled = true;
  try {
    const response = await rpc('HELLO');
    connected = response?.ok === true && response.version === '1.2.0';
    $('connection').textContent = connected ? 'Chrome拡張機能に接続しました。' : response?.ok ? '撮影してから送信する新しい拡張機能へ更新してください。下の「初回の準備・拡張機能の更新」を開いてください。' : response?.error || '拡張機能に接続できませんでした。';
    if (connected) {
      $('setup').open = false;
      if (!currentId) notice('魔法を選んで、写真を撮りましょう。', '写真を確認して「この写真で生成」を押すと、Geminiへまとめて送信します。');
      if (currentId) await poll();
    } else {$('setup').open = true; camera.stop(); restoring = false;}
    updateButton();
  } finally {$('check').disabled = false;}
}

$('start').addEventListener('click', () => {
  if (!readyForPhoto()) return;
  $('photo-section').scrollIntoView({behavior: 'smooth', block: 'start'});
  if (!camera.photo && camera.state !== 'live' && !['requesting', 'capturing'].includes(camera.state)) void camera.start($('camera-device').value);
});

$('camera-start').addEventListener('click', () => {if (readyForPhoto()) void camera.start($('camera-device').value);});
$('camera-device').addEventListener('change', () => {if (readyForPhoto()) void camera.start($('camera-device').value);});
$('capture').addEventListener('click', () => {if (readyForPhoto()) void camera.capture();});
$('retake').addEventListener('click', () => {if (readyForPhoto()) void camera.start($('camera-device').value);});
$('choose-photo').addEventListener('click', () => {if (readyForPhoto()) $('photo-file').click();});
$('photo-file').addEventListener('change', () => {
  const file = $('photo-file').files?.[0]; $('photo-file').value = '';
  if (readyForPhoto() && file) void camera.setFile(file);
});

$('send-photo').addEventListener('click', async () => {
  if (!readyForPhoto() || !camera.photo || !camera.previewUrl || !previewReady || camera.state !== 'photo') return;
  const photo = camera.photo;
  const id = crypto.randomUUID();
  currentId = id;
  sessionStorage.setItem('quest-local-request', id);
  sessionStorage.removeItem('quest-local-photo-request');
  busy = true; currentJob = {requestId: id, spellId: selectedId, status: 'opening'};
  camera.stop(); updateButton(); $('chat-link').hidden = true;
  notice('魔法の指示と写真をまとめて送ります。', 'Geminiの新しいチャットを開き、画像生成まで自動で進めます。', 'opening');
  const response = await rpc('QUEST_START', {requestId: id, spellId: selectedId, photo});
  if (id !== currentId) return;
  if (!response?.ok) {
    if (response?.transportFailure) await poll();
    else uncertain(response?.error || '写真の送信結果を確認できませんでした。');
    return;
  }
  showJob(response.job);
  if (busy) pollTimer = setTimeout(poll, 1000);
});

$('chat-link').addEventListener('click', async (event) => {
  if (!currentId || !connected) return;
  event.preventDefault();
  const response = await rpc('OPEN_CHAT', {requestId: currentId});
  if (!response?.ok) notice('今回のGeminiを開けませんでした。', response?.error || '既に開いているGeminiのタブを確認してください。', 'needs_attention');
});
$('check').addEventListener('click', connect);
$('reset').addEventListener('click', () => {
  if (busy || restoring || !currentJob || !terminal.has(currentJob.status)) return;
  clearTimeout(pollTimer);
  currentId = null; currentJob = null;
  sessionStorage.removeItem('quest-local-request'); sessionStorage.removeItem('quest-local-photo-request');
  camera.clearPhoto(); $('chat-link').hidden = true;
  updateButton(); notice('新しい冒険を準備できます。', '魔法を選んで写真を用意してください。送信するまでGeminiは開きません。');
});

let extensionPath = '.local/crystal-quest-extension';
async function copy(text) {
  try {await navigator.clipboard.writeText(text); $('connection').textContent = 'コピーしました。';} catch {$('connection').textContent = '表示された文字列を選択してコピーしてください。';}
}
$('copy-extensions').addEventListener('click', () => copy('chrome://extensions'));
$('copy-path').addEventListener('click', () => copy(extensionPath));
fetch('/local-info.json').then((r) => r.json()).then((data) => {extensionPath = data.extensionPath; $('extension-path').textContent = extensionPath;}).catch(() => {});
window.addEventListener('pagehide', () => camera.destroy());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) camera.stop();
  else if (connected && currentId) void poll();
});
renderSpell();
connect();
