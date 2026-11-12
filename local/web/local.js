import {SPELLS, getSpell} from '/assets/quest.js';
import {buildLocalQuestPrompt as buildQuestPrompt} from '/assets/local-prompt.js';
import {CameraCapture} from './camera.js';

const $ = (id) => document.getElementById(id);
const channel = 'crystal-quest-local';
const terminal = new Set(['completed', 'failed', 'needs_attention']);
const photoProcessing = new Set(['photo_preparing', 'photo_submitted', 'generating']);
let selectedId = 'ultima';
let connected = false;
let busy = false;
let currentId = sessionStorage.getItem('quest-local-request') || null;
let currentJob = null;
let restoring = Boolean(currentId);
let pollTimer;
let polling = false;
let photoDispatchInFlight = false;
let cameraErrorText = '';
let previewReady = false;
let previewErrorText = '';
let pendingPhoto = null;
try {pendingPhoto = JSON.parse(sessionStorage.getItem('quest-local-photo-request') || 'null');} catch { /* No recoverable photo attempt. */ }
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
    }, type === 'PHOTO_START' ? 10_000 : 4000);
    pending.set(rpcId, (result) => {clearTimeout(timer); pending.delete(rpcId); resolve(result);});
    window.postMessage({channel, direction: 'request', rpcId, type, ...data}, location.origin);
  });
}

function photoAttempted() {return pendingPhoto?.requestId === currentId || Boolean(currentJob?.photoRequestId || currentJob?.photoSubmitAttempted);}
function readyForPhoto() {return connected && !busy && currentJob?.status === 'awaiting_photo' && !photoAttempted();}

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
  const attempted = photoAttempted();
  $('capture-stage').dataset.cameraState = camera.state;
  $('camera-video').hidden = camera.state !== 'live';
  $('photo-preview').hidden = !camera.photo;
  $('camera-placeholder').hidden = camera.state === 'live' || Boolean(camera.photo);
  $('camera-placeholder').querySelector('small').textContent = camera.state === 'requesting' ? 'カメラの使用許可を待っています。' : camera.state === 'capturing' ? '写真を準備しています。' : ready ? 'カメラを起動するか、保存済みの写真を選んでください。' : 'クエストを開始すると、撮影できるようになります。';
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
  $('send-photo').textContent = busy && photoProcessing.has(currentJob?.status) ? '画像を生成しています…' : attempted ? 'この写真の送信は終了しています' : 'この写真で生成';
  let message;
  if (previewErrorText && ready) message = previewErrorText;
  else if (camera.state === 'error' && ready) message = cameraErrorText;
  else if (photoProcessing.has(currentJob?.status)) message = '確認した写真をGeminiへ送信し、画像生成の完了を待っています。';
  else if (currentJob?.status === 'completed') message = 'Geminiで画像の生成を確認しました。新しい冒険では、別の写真や魔法を使えます。';
  else if (attempted) message = 'この冒険では写真の送信を開始済みです。重複送信を避けるため、Geminiの結果を確認してください。';
  else if (!ready) message = 'まずは魔法を選んで冒険を開始してください。準備ができると、この画面で撮影できます。';
  else if (camera.state === 'requesting') message = 'カメラの使用許可を待っています。許可すると、この画面にプレビューが表示されます。';
  else if (camera.state === 'capturing') message = '写真のプレビューを準備しています。';
  else if (camera.state === 'live') message = 'あなたとまものが写るように構え、「この瞬間を撮影」を押してください。';
  else if (camera.photo) message = '送信する写真を確認してください。よければ「この写真で生成」を押してください。';
  else message = '冒険の準備ができました。「カメラを起動」または「保存済みの写真を選ぶ」から写真を用意してください。';
  $('camera-message').textContent = message;
  $('camera-message').dataset.error = String(camera.state === 'error' || Boolean(previewErrorText));
  $('photo-step').textContent = currentJob?.status === 'completed' ? '画像ができました' : photoProcessing.has(currentJob?.status) ? 'Geminiで画像を生成中' : ready ? '写真を撮って、魔法の世界へ' : attempted ? 'Geminiの結果を確認' : 'まずは魔法を選んで開始';
}

function updateButton() {
  const locked = busy || restoring || Boolean(currentJob);
  $('start').disabled = !connected || locked;
  $('start').textContent = !connected ? '拡張機能を追加・更新してください' : currentJob?.status === 'awaiting_photo' ? '下の画面で写真を撮影してください' : currentJob?.status === 'completed' ? '冒険の一枚ができました' : busy || restoring ? 'Geminiを準備しています…' : `${getSpell(selectedId).name}で冒険をはじめる`;
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
  radio.addEventListener('change', () => {if (radio.checked && !currentJob && !busy) {selectedId = spell.id; renderSpell();}});
  label.append(radio, card); $('spells').append(label);
});

function notice(title, detail, state = '') {
  $('run-title').textContent = title;
  $('run-detail').textContent = detail;
  $('run-title').parentElement.dataset.state = state;
}

function showJob(job) {
  if (!job || (currentJob?.updatedAt && job.updatedAt && job.updatedAt < currentJob.updatedAt)) return busy;
  if (job.status === 'awaiting_photo' && pendingPhoto?.requestId === currentId && !job.photoRequestId) {
    if (photoDispatchInFlight) return busy;
    uncertain('写真の送信要求が受け付けられたか確認できません。');
    return false;
  }
  currentJob = {...job, status: job.status || job.state};
  const state = currentJob.status;
  busy = state !== 'awaiting_photo' && !terminal.has(state);
  const spell = getSpell(job.spellId);
  selectedId = spell.id;
  document.querySelector(`input[value="${spell.id}"]`).checked = true;
  if (state !== 'awaiting_photo' && ['live', 'requesting', 'capturing'].includes(camera.state)) camera.stop();
  renderSpell();
  const texts = {
    opening: ['Geminiを開いています。', '新しいチャットの入力欄を待っています。'],
    filling: ['クエストの指示を入力しています。', '全文を確認し、送信は1回だけ行います。'],
    submitted: ['指示を送信しています。', '送信操作とGeminiからの歓迎文を確認しています。'],
    awaiting_photo: ['冒険の準備ができました。', '下の撮影画面から写真を用意し、「この写真で生成」を押してください。'],
    photo_preparing: ['写真を添付しています。', '準備した同じGeminiチャットで、写真の添付を確認しています。'],
    photo_submitted: ['写真を送信しています。', '送信操作とGeminiの受信を確認しています。写真を自動で再送することはありません。'],
    generating: ['Geminiで画像を生成しています。', '今回のチャットを閉じずにお待ちください。生成が終わると、そのチャットに画像が表示されます。'],
    completed: ['冒険の一枚ができました。', 'Geminiで画像の生成を確認しました。「今回のGeminiを開く」から画像を確認できます。'],
    needs_attention: ['Geminiの画面を確認してください。', '処理結果を確定できませんでした。重複送信を避けるため、自動で再送することはありません。'],
    failed: ['準備を完了できませんでした。', 'Geminiのログインや画面の状態を確認してください。'],
  };
  const [title, detail] = texts[state] || ['処理状況を確認しています。', 'Geminiの画面を閉じずにお待ちください。'];
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
    connected = response?.ok === true && response.version === '1.1.0';
    $('connection').textContent = connected ? 'Chrome拡張機能に接続しました。' : response?.ok ? '撮影対応の拡張機能へ更新してください。下の「初回の準備・拡張機能の更新」を開いてください。' : response?.error || '拡張機能に接続できませんでした。';
    if (connected) {
      $('setup').open = false;
      if (!currentId) notice('魔法を選んで、冒険をはじめましょう。', '準備ができると、この画面でカメラ撮影から画像生成まで進められます。');
      if (currentId) await poll();
    } else {$('setup').open = true; camera.stop(); restoring = false;}
    updateButton();
  } finally {$('check').disabled = false;}
}

$('start').addEventListener('click', async () => {
  if (!connected || busy || currentJob || restoring) return;
  busy = true;
  camera.clearPhoto();
  currentId = crypto.randomUUID();
  sessionStorage.setItem('quest-local-request', currentId);
  sessionStorage.removeItem('quest-local-photo-request'); pendingPhoto = null;
  currentJob = {requestId: currentId, spellId: selectedId, status: 'opening'};
  updateButton(); $('chat-link').hidden = true;
  notice('冒険の準備をはじめます。', 'Geminiの新しいタブを開きます。');
  const id = currentId;
  const response = await rpc('START', {spellId: selectedId, requestId: id});
  if (id !== currentId) return;
  if (!response?.ok) {
    if (response?.transportFailure) await poll();
    else uncertain(response?.error || '開始できませんでした。');
    return;
  }
  showJob(response.job);
  if (busy) pollTimer = setTimeout(poll, 1000);
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
  const id = currentId;
  const photo = camera.photo;
  pendingPhoto = {requestId: id, photoRequestId: crypto.randomUUID()};
  // Keep only the attempt ID, never the photo, so a reload cannot cause a resend.
  sessionStorage.setItem('quest-local-photo-request', JSON.stringify(pendingPhoto));
  busy = true; currentJob = {...currentJob, status: 'photo_preparing'};
  photoDispatchInFlight = true;
  camera.stop(); updateButton();
  notice('この写真で画像を生成します。', '同じGeminiチャットへの添付・送信を確認しています。', 'photo_preparing');
  const response = await rpc('PHOTO_START', {requestId: id, photoRequestId: pendingPhoto.photoRequestId, photo});
  photoDispatchInFlight = false;
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
  currentId = null; currentJob = null; pendingPhoto = null;
  sessionStorage.removeItem('quest-local-request'); sessionStorage.removeItem('quest-local-photo-request');
  camera.clearPhoto(); $('chat-link').hidden = true;
  updateButton(); notice('新しい冒険を準備できます。', '魔法を選び、開始ボタンを押すと別のGeminiチャットを開きます。');
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
