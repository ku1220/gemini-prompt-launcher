import { SPELLS, getSpell, buildQuestPrompt } from './quest.js';
import { detectPlatform, appLink, registeredQuestLink } from './launcher.js';
import { REGISTERED_PROMPTS } from './launch-config.js';

const $ = (id) => document.getElementById(id);
let selectedId = 'ultima';
let copying = false;

function announce(text, kind = 'success') {
  $('status').textContent = text;
  $('status').dataset.kind = kind;
}

function platform() {
  const value = $('platform').value;
  return value === 'auto' ? detectPlatform(navigator.userAgent, navigator.maxTouchPoints) : value;
}

function render() {
  const spell = getSpell(selectedId);
  $('spell-name').textContent = spell.name;
  $('spell-description').textContent = spell.description;
  $('prompt-preview').value = buildQuestPrompt(selectedId);
  $('prepare-button').textContent = `${spell.name}で冒険をはじめる`;
  $('start-link').textContent = `${spell.name}で冒険をはじめる`;
  $('app-link').href = appLink(platform());
  $('app-link').rel = 'noreferrer';
  const registered = registeredQuestLink(REGISTERED_PROMPTS[selectedId], platform());
  $('start-link').hidden = !registered;
  $('prepare-button').hidden = !!registered;
  if (registered) {
    $('start-link').href = registered;
    $('start-link').rel = 'noreferrer';
    $('start-mode').textContent = '登録済みのプロンプトをGeminiで開始します。';
    $('flow-note').textContent = 'Geminiの案内が出たら「＋」から写真を送信してください。アプリの起動は端末設定に依存します。';
  } else {
    $('start-link').removeAttribute('href');
    $('start-mode').textContent = '現在は初回の貼り付け・送信が必要です。';
    $('flow-note').textContent = 'FF用のプロンプトをコピーし、Geminiで1回送信します。案内が出たら「＋」から写真を送信してください。';
  }
  document.body.dataset.spell = selectedId;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* Try manual fallback. */ }
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  ($('handoff-dialog').open ? $('handoff-dialog') : document.body).append(field);
  field.focus();
  field.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { /* Offer visible selection. */ }
  field.remove();
  return copied;
}

function selectPrompt(inDialog) {
  const field = inDialog ? $('dialog-prompt') : $('prompt-preview');
  if (inDialog) {
    $('dialog-prompt-wrap').hidden = false;
  } else $('prompt-details').open = true;
  field.value = buildQuestPrompt(selectedId);
  field.focus();
  field.select();
}

async function copyPrompt(inDialog = false) {
  if (copying) return;
  const id = selectedId;
  copying = true;
  $('dialog-copy-button').disabled = true;
  const copied = await copyText(buildQuestPrompt(id));
  copying = false;
  $('dialog-copy-button').disabled = false;
  const same = selectedId === id;
  const message = !same ? '魔法が変更されました。最新のプロンプトをもう一度コピーしてください。'
    : copied ? 'プロンプトをコピーしました。Geminiを開き、入力欄に貼り付けて送信してください。'
    : '自動コピーを使えません。本文を選択し、端末の「コピー」を使ってください。';
  if (inDialog) {
    $('handoff-message').textContent = message;
    $('select-prompt-button').hidden = copied && same;
  } else announce(message, copied && same ? 'success' : 'error');
  if (!copied && same) selectPrompt(inDialog);
  if (copied && same && inDialog && $('handoff-dialog').open) $('app-link').focus({ preventScroll: true });
}

document.querySelectorAll('input[name="spell"]').forEach((input) => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    getSpell(input.value);
    selectedId = input.value;
    render();
    announce(`${getSpell(selectedId).name}を選択しました。`);
  });
});

$('prepare-button').addEventListener('click', () => {
  $('handoff-title').textContent = `${getSpell(selectedId).name}で冒険へ`;
  $('handoff-message').textContent = 'はじめにプロンプトをGeminiで送信します。撮影は、その後のGeminiの案内に沿って行ってください。';
  $('select-prompt-button').hidden = true;
  $('dialog-prompt-wrap').hidden = true;
  $('handoff-dialog').showModal();
});
$('close-dialog').addEventListener('click', () => $('handoff-dialog').close());
$('dialog-copy-button').addEventListener('click', () => void copyPrompt(true));
$('copy-prompt').addEventListener('click', () => void copyPrompt());
$('select-prompt-button').addEventListener('click', () => selectPrompt(true));
$('platform').addEventListener('change', render);
$('download-prompt').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([buildQuestPrompt(selectedId)], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `crystal-quest-${selectedId}.txt`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('プロンプトをテキストとして保存します。');
});

// Only known spell IDs are accepted. Query text never becomes a navigation URL.
const initialSpell = new URL(window.location.href).searchParams.get('spell');
if (SPELLS.some((spell) => spell.id === initialSpell)) {
  selectedId = initialSpell;
  document.querySelector(`input[name="spell"][value="${selectedId}"]`).checked = true;
}
$('handoff-message').setAttribute('aria-live', 'polite');
render();
