import {SPELLS, getSpell, buildQuestPrompt} from '/assets/quest.js';

const $ = (id) => document.getElementById(id);
const channel = 'crystal-quest-local';
const terminal = new Set(['completed', 'failed', 'needs_attention']);
let selectedId = 'ultima';
let connected = false;
let busy = false;
let currentId = sessionStorage.getItem('quest-local-request') || null;
let pollTimer;
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
      resolve({ok: false, transportFailure: true, error: '拡張機能から応答がありません。Chromeでこのページを開き、初回の準備を確認してください。'});
    }, 4000);
    pending.set(rpcId, (result) => {clearTimeout(timer); pending.delete(rpcId); resolve(result);});
    window.postMessage({channel, direction: 'request', rpcId, type, ...data}, location.origin);
  });
}

function updateButton() {
  $('start').disabled = !connected || busy;
  $('start').textContent = !connected ? '拡張機能を追加してください' : busy ? 'Geminiを準備しています…' : `${getSpell(selectedId).name}で冒険をはじめる`;
  document.querySelectorAll('input[name=spell]').forEach((input) => {input.disabled = busy;});
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
  for (const [className, tag, text] of [['spell-check', 'span', '✓'], ['spell-symbol', 'span', symbols[index]], ['spell-english', 'span', spell.id.toUpperCase()], ['', 'strong', spell.name], ['spell-element', 'span', spell.element || '写真から、魔法の世界へ']]) {
    const part = document.createElement(tag); part.className = className; part.textContent = text; card.append(part);
  }
  radio.addEventListener('change', () => {if (radio.checked) {selectedId = spell.id; renderSpell();}});
  label.append(radio, card); $('spells').append(label);
});

function notice(title, detail, state = '') {
  $('run-title').textContent = title;
  $('run-detail').textContent = detail;
  $('run-title').parentElement.dataset.state = state;
  $('reset').hidden = state !== 'needs_attention';
}

function showJob(job) {
  if (!job) return false;
  const state = job.state || job.status;
  busy = !terminal.has(state);
  const spell = getSpell(job.spellId);
  selectedId = spell.id;
  document.querySelector(`input[value="${spell.id}"]`).checked = true;
  renderSpell();
  const texts = {
    opening: ['Geminiを開いています。', '新しいチャットの入力欄を待っています。'],
    filling: ['クエストの指示を入力しています。', '全文を確認し、送信は1回だけ行います。'],
    submitted: ['指示を送信しています。', '送信操作とGeminiからの歓迎文を確認しています。'],
    completed: ['冒険の準備ができました。', 'Geminiに歓迎文が表示されました。「＋」から写真を選び、送信してください。'],
    needs_attention: ['Geminiの画面を確認してください。', '送信結果を確定できませんでした。同じ指示を自動で再送することはありません。'],
    failed: ['準備を完了できませんでした。', 'Geminiのログインや画面の状態を確認してください。'],
  };
  const [title, detail] = texts[state] || ['処理状況を確認しています。', 'Geminiの画面を閉じずにお待ちください。'];
  notice(title, job.message || detail, state);
  if (typeof job.url === 'string' && /^https:\/\/gemini\.google\.com\/app(?:\/[^?#]*)?(?:[?#].*)?$/.test(job.url)) {
    $('chat-link').href = job.url; $('chat-link').hidden = false;
  } else $('chat-link').hidden = true;
  return busy;
}

async function poll() {
  clearTimeout(pollTimer);
  if (!currentId) return;
  const result = await rpc('STATUS', {requestId: currentId});
  if (!result.ok) {
    busy = true; updateButton();
    notice('処理状況を確認できません。', `${result.error} Gemini側で送信済みの可能性があるため、ボタンからの再送は止めています。`, 'needs_attention');
    return;
  }
  if (showJob(result.job)) pollTimer = setTimeout(poll, 1300);
}

async function connect() {
  $('check').disabled = true;
  const response = await rpc('HELLO');
  connected = response.ok === true;
  $('connection').textContent = connected ? 'Chrome拡張機能に接続しました。' : response.error;
  if (connected) {
    $('setup').open = false;
    if (!currentId) notice('魔法を選んで、冒険をはじめましょう。', 'ボタンを押すと、Geminiの新しいチャットへ指示を入力・送信します。');
  }
  $('check').disabled = false;
  updateButton();
  if (connected && currentId) await poll();
}

$('start').addEventListener('click', async () => {
  if (!connected || busy) return;
  busy = true; updateButton();
  currentId = crypto.randomUUID();
  sessionStorage.setItem('quest-local-request', currentId);
  $('chat-link').hidden = true;
  notice('冒険の準備をはじめます。', 'Geminiの新しいタブを開きます。');
  const response = await rpc('START', {spellId: selectedId, requestId: currentId});
  if (!response.ok) {
    if (!response.transportFailure) {
      busy = false;
      currentId = null;
      sessionStorage.removeItem('quest-local-request');
      updateButton();
      notice('開始できませんでした。', response.error, 'needs_attention');
      return;
    }
    // A lost response can follow an accepted start. Never retry START automatically.
    notice('開始の結果を確認しています。', response.error, 'needs_attention');
    await poll();
    return;
  }
  showJob(response.job);
  if (busy) pollTimer = setTimeout(poll, 1000);
});
$('check').addEventListener('click', connect);
$('reset').addEventListener('click', () => {
  clearTimeout(pollTimer);
  currentId = null; busy = false;
  sessionStorage.removeItem('quest-local-request');
  updateButton();
  notice('新しい冒険を準備できます。', '開始ボタンを押すと別のGeminiチャットを開きます。');
});
let extensionPath = '.local/crystal-quest-extension';
async function copy(text) {
  try {await navigator.clipboard.writeText(text); notice('コピーしました。', text);} catch {notice('表示された文字列を選択してコピーしてください。', text);}
}
$('copy-extensions').addEventListener('click', () => copy('chrome://extensions'));
$('copy-path').addEventListener('click', () => copy(extensionPath));
fetch('/local-info.json').then((r) => r.json()).then((data) => {extensionPath = data.extensionPath; $('extension-path').textContent = extensionPath;}).catch(() => {});
renderSpell();
connect();
