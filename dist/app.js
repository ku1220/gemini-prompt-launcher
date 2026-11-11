import { SPELLS, getSpell, buildQuestPrompt } from './quest.js';
import { detectPlatform, appLink } from './launcher.js';

const $ = (id) => document.getElementById(id);
let selectedId = 'ultima';

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
  $('prepare-button').textContent = `${spell.name}を手動で準備`;
  $('app-link').href = appLink(platform());
  $('app-link').rel = 'noreferrer';
  $('start-mode').textContent = '自動入力は利用できていません。初回は手動での送信が必要です。';
  $('flow-note').textContent = '本文を選択して端末の機能でコピーし、Geminiへ貼り付けて送信してください。案内が出たら「＋」から写真を送信します。自動入力・自動実行は未実装です。';
  document.body.dataset.spell = selectedId;
}

function selectPrompt(inDialog) {
  const field = inDialog ? $('dialog-prompt') : $('prompt-preview');
  if (inDialog) {
    $('dialog-prompt-wrap').hidden = false;
  } else $('prompt-details').open = true;
  field.value = buildQuestPrompt(selectedId);
  field.focus();
  field.select();
  field.setSelectionRange(0, field.value.length);
  const message = '本文を選択しました。端末の「コピー」（PCでは⌘C / Ctrl+C）を使い、Geminiに貼り付けて送信してください。';
  if (inDialog) $('handoff-message').textContent = message;
  else announce(message);
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
  $('handoff-message').textContent = '「本文を選択」を押し、端末の「コピー」を使ってください。その後Geminiを開き、貼り付けて送信します。';
  $('dialog-prompt').value = buildQuestPrompt(selectedId);
  $('dialog-prompt-wrap').hidden = false;
  $('handoff-dialog').showModal();
});
$('close-dialog').addEventListener('click', () => $('handoff-dialog').close());
$('dialog-copy-button').addEventListener('click', () => selectPrompt(true));
$('copy-prompt').addEventListener('click', () => selectPrompt(false));
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

// Only known spell IDs are accepted; the outbound prompt is always generated locally.
const initialSpell = new URL(window.location.href).searchParams.get('spell');
if (SPELLS.some((spell) => spell.id === initialSpell)) {
  selectedId = initialSpell;
  document.querySelector(`input[name="spell"][value="${selectedId}"]`).checked = true;
}
$('handoff-message').setAttribute('aria-live', 'polite');
render();
