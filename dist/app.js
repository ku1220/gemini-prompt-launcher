import { MAX_PROMPT_LENGTH, MAX_URL_BYTES, detectPlatform, appLink, validatePrompt, prefilledLink, shareLink, readIncomingPrompt } from './launcher.js';

const $ = (id) => document.getElementById(id);
const prompt = $('prompt');
const platform = $('platform');
const saveDraft = $('save-draft');
const storageKey = 'prompt-bridge:draft:v1';
let clearedPrompt = '';
let copyInProgress = false;
let initialMessage = '';

const templates = {
  research: 'あなたはリサーチアシスタントです。以下のテーマを調査してください。\n\n【テーマ】\n\n【背景・目的】\n\n【知りたいこと】\n1. 主要な事実と全体像\n2. 選択肢の比較と根拠\n3. 次に取るべき行動\n\n【出力形式】\n要点を整理し、確認できる出典URLを付けてください。事実と推測を区別し、不明な点は明示してください。',
  writing: 'あなたは編集者です。以下の条件で文章を作成してください。\n\n【文章の目的】\n\n【想定する読者】\n\n【伝えたい内容】\n\n【トーン】\nわかりやすく、具体的で、自然な日本語。\n\n【長さ・構成】\n\nまず構成案を示し、その後に本文を作成してください。',
  code: 'あなたは経験豊富なエンジニアです。以下のコードをレビューしてください。\n\n【言語・環境】\n\n【期待する動作】\n\n【気になっている点】\n\n【コード】\n```\n\n```\n\n不具合、境界条件、セキュリティ、保守性の順に確認してください。問題の根拠と、具体的な修正案を示してください。'
};

function announce(message, kind = 'success') {
  $('status').dataset.kind = kind;
  $('status').textContent = message;
}

function resolvedPlatform() {
  return platform.value === 'auto' ? detectPlatform(navigator.userAgent, navigator.maxTouchPoints) : platform.value;
}

function setLink(element, url) {
  element.setAttribute('aria-disabled', String(!url));
  element.rel = 'noreferrer';
  if (url) element.href = url;
  else element.removeAttribute('href');
}

function persistDraft({ remove = false } = {}) {
  if (!remove && (!saveDraft.checked || prompt.value.length > MAX_PROMPT_LENGTH)) return true;
  try {
    if (remove) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, prompt.value);
    return true;
  } catch {
    saveDraft.checked = false;
    announce('このブラウザでは下書きを保存できません。入力内容はこの画面に残っています。', 'error');
    return false;
  }
}

function update({ persist = false } = {}) {
  const value = prompt.value;
  const error = validatePrompt(value);
  const valid = !error;
  const tooLong = value.length > MAX_PROMPT_LENGTH;
  $('char-count').replaceChildren(document.createTextNode(value.length.toLocaleString('ja-JP') + ' '));
  const suffix = document.createElement('span');
  suffix.textContent = '文字';
  $('char-count').append(suffix);
  $('input-error').hidden = !tooLong;
  $('input-error').textContent = tooLong ? error : '';
  prompt.setAttribute('aria-invalid', String(tooLong));
  $('copy-button').disabled = !valid || copyInProgress;
  $('download-button').disabled = !valid;
  $('share-button').disabled = !valid;
  $('clear-button').disabled = !value && !clearedPrompt;
  $('clear-button').textContent = !value && clearedPrompt ? '元に戻す' : 'クリア';
  const device = resolvedPlatform();
  const names = { android: 'Androidアプリへのリンクを試します。起動は端末設定に依存します。', ios: 'iPhone / iPadのUniversal Linkを使います。起動は端末設定に依存します。', web: 'GeminiのWeb版を開きます。' };
  $('platform-hint').textContent = names[device];
  setLink($('app-link'), valid ? appLink(device) : null);
  const prefill = prefilledLink(value);
  setLink($('prefill-link'), prefill.url);
  $('url-hint').textContent = !valid ? (tooLong ? error : 'プロンプトを入力すると利用できます。') : prefill.error || `URL ${prefill.bytes.toLocaleString('ja-JP')} / ${MAX_URL_BYTES.toLocaleString('ja-JP')} バイト`;
  if (persist) persistDraft();
}

async function copyText(text) {
  // Never change the prompt or truncate it to satisfy a URL limit.
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* Try the browser fallback. */ }
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  document.body.append(field);
  field.focus();
  field.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { /* Offer manual selection below. */ }
  field.remove();
  return copied;
}

prompt.addEventListener('input', () => {
  clearedPrompt = '';
  $('share-output-wrap').hidden = true;
  $('status').textContent = '';
  update({ persist: true });
});
platform.addEventListener('change', () => update());
saveDraft.addEventListener('change', () => {
  if (!persistDraft({ remove: !saveDraft.checked })) return;
  announce(saveDraft.checked ? '下書きをこのブラウザに保存します。共有端末ではチェックを外してください。' : '保存済みの下書きをこのブラウザから削除しました。');
});

$('copy-button').addEventListener('click', async () => {
  const value = prompt.value;
  if (validatePrompt(value) || copyInProgress) return;
  copyInProgress = true;
  update();
  const copied = await copyText(value);
  copyInProgress = false;
  update();
  if (value !== prompt.value) {
    announce('コピー処理中に内容が変わりました。最新の内容をもう一度コピーしてください。', 'error');
  } else if (copied) {
    announce('全文をコピーしました。「Geminiを開く」から移動し、入力欄に貼り付けてください。');
    $('app-link').focus({ preventScroll: true });
  } else {
    prompt.focus();
    prompt.select();
    announce('自動コピーを利用できません。本文を選択しました。端末の「コピー」を使ってからGeminiを開いてください。', 'error');
  }
});

for (const id of ['app-link', 'prefill-link']) {
  $(id).addEventListener('click', (event) => {
    if ($(id).getAttribute('aria-disabled') === 'true') event.preventDefault();
    // Use the anchor's direct user activation. No timed redirects or guessed app detection.
  });
}

document.querySelectorAll('[data-template]').forEach((button) => {
  button.addEventListener('click', () => {
    const text = templates[button.dataset.template];
    prompt.value = prompt.value.trim() ? `${prompt.value}\n\n${text}` : text;
    clearedPrompt = '';
    update({ persist: true });
    announce('テンプレートを追加しました。空欄を埋めて編集してください。');
    prompt.focus();
  });
});

$('clear-button').addEventListener('click', () => {
  if (!prompt.value && clearedPrompt) {
    prompt.value = clearedPrompt;
    clearedPrompt = '';
    announce('入力内容を元に戻しました。');
  } else {
    clearedPrompt = prompt.value;
    prompt.value = '';
    announce('クリアしました。「元に戻す」で復元できます。');
  }
  $('share-output-wrap').hidden = true;
  update({ persist: true });
  prompt.focus();
});

$('import-button').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!/\.(txt|md)$/i.test(file.name) || file.size > 2_000_000) {
    announce('2MB以下の .txt または .md ファイルを選んでください。', 'error');
    return;
  }
  // Read independently, then validate before replacing any existing text.
  const before = prompt.value;
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    const error = validatePrompt(content);
    if (error) { announce(error + ' 現在の入力は変更していません。', 'error'); return; }
    if (prompt.value !== before) { announce('読込中に入力が変わったため、読込を中止しました。もう一度ファイルを選んでください。', 'error'); return; }
    // Append to preserve work already entered.
    const combined = before.trim() ? `${before}\n\n${content}` : content;
    const combinedError = validatePrompt(combined);
    if (combinedError) { announce(combinedError + ' 現在の入力は変更していません。', 'error'); return; }
    prompt.value = combined;
    clearedPrompt = '';
    update({ persist: true });
    announce('ファイルの内容を追加しました。文字化けがないか確認してください。');
  } catch {
    announce('読み込めませんでした。UTF-8のテキストファイルを選んでください。', 'error');
  }
});

$('download-button').addEventListener('click', () => {
  if (validatePrompt(prompt.value)) return;
  const url = URL.createObjectURL(new Blob([prompt.value], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'gemini-prompt.txt';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('テキストファイルの保存を開始しました。');
});

$('share-button').addEventListener('click', async () => {
  const result = shareLink(prompt.value, window.location.href);
  if (result.error) { announce(result.error, 'error'); return; }
  const copied = await copyText(result.url);
  if (copied) announce('共有リンクをコピーしました。リンクを知る人は本文を読めます。共有先を確認してください。');
  else {
    $('share-output-wrap').hidden = false;
    $('share-output').value = result.url;
    $('share-output').focus();
    $('share-output').select();
    announce('リンクを選択しました。端末の「コピー」を使ってください。', 'error');
  }
});

try {
  const draft = localStorage.getItem(storageKey);
  if (draft !== null && draft.length <= MAX_PROMPT_LENGTH) {
    prompt.value = draft;
    saveDraft.checked = true;
    initialMessage = 'このブラウザに保存した下書きを復元しました。';
  }
} catch { /* Storage is optional. Editing still works. */ }

function consumeIncoming() {
  const incoming = readIncomingPrompt(window.location.href);
  if (!incoming.cleanUrl) return;
  // Remove received prompt content from the visible URL before any outbound navigation.
  try { history.replaceState(null, '', incoming.cleanUrl); } catch { /* Referrers are also disabled. */ }
  if (incoming.error) initialMessage = incoming.error;
  else {
    if (saveDraft.checked && prompt.value && prompt.value !== incoming.prompt) {
      initialMessage = 'リンクの本文を読み込みました。保存済みの下書きは保持しています。下書きを置き換える場合は保存にチェックしてください。';
    } else initialMessage = 'リンクの本文を読み込みました。内容を確認してからGeminiへ渡してください。';
    prompt.value = incoming.prompt;
    clearedPrompt = '';
    $('share-output-wrap').hidden = true;
    // Opening an untrusted link must never overwrite a saved local draft automatically.
    saveDraft.checked = false;
  }
  update();
  announce(initialMessage, incoming.error ? 'error' : 'success');
}
update();
if (initialMessage) announce(initialMessage);
consumeIncoming();
window.addEventListener('hashchange', consumeIncoming);
