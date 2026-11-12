// Chrome serializes this function for executeScript. Keep all dependencies
// inside it. Photo bytes live only for the duration of the prepare call.
export async function runPhotoDriver(options) {
  const {phase, expectedUrl, prompt, requestId, photoRequestId, photoDigest, photo} = options;
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 60_000, 1), phase === 'send' ? 240_000 : 60_000);
  const started = Date.now();
  const markerKey = 'crystalQuestPhoto';
  const normalize = (text) => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\n+/g, '\n').trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const attention = (message, extra = {}) => ({status: 'needs_attention', message, ...extra});
  const visible = (element) => {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const root = () => document.querySelector('main, [role="main"]') || document.body;
  const nodes = (selectors, scope = root(), onlyVisible = true) => [...new Set(selectors.flatMap((selector) => [...scope.querySelectorAll(selector)]))].filter((node) => !onlyVisible || visible(node));
  const outermost = (items) => items.filter((item) => !items.some((other) => other !== item && other.contains(item)));
  const users = () => outermost(nodes(['user-query', '[data-test-id="user-query"]']));
  const userText = (query) => {
    // Gemini adds a screen-reader heading containing a shortened copy before
    // the real prompt. Read only its displayed lines, without nested repeats.
    const lines = outermost(nodes(['.query-text-line'], query));
    return lines.length ? lines.map((line) => line.innerText).join('\n') : query.innerText;
  };
  const models = () => outermost(nodes(['model-response', '[data-test-id="model-response"]']));
  const editors = () => nodes(['rich-textarea [contenteditable="true"][role="textbox"]', '.ql-editor[contenteditable="true"]', 'textarea[aria-label="Gemini に相談"]', 'textarea[aria-label="Enter a prompt here"]']);
  const editorText = (editor) => typeof editor.value === 'string' ? editor.value : editor.innerText;
  const enabled = (button) => !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  const sendButtons = () => nodes(['button[aria-label="送信"]', 'button[aria-label="プロンプトを送信"]', 'button[aria-label="Send message"]', 'button[aria-label="Send"]', 'button.send-button', 'button[data-test-id="send-button"]']);
  const generating = () => nodes(['button[aria-label="回答を停止"]', 'button[aria-label="生成を停止"]', 'button[aria-label="Stop response"]', 'button[aria-label="Stop generating"]']).length > 0;
  const imageNodes = (scope) => nodes(['img'], scope).filter((image) => {
    const rect = image.getBoundingClientRect();
    return image.complete && image.naturalWidth >= 256 && image.naturalHeight >= 256 && rect.width >= 128 && rect.height >= 128 && Boolean(image.currentSrc || image.src);
  });
  const uniqueImages = (items) => [...new Map(items.map((image) => [image.currentSrc || image.src, image])).values()];
  let expectedPath;
  let boundPath = null;
  let submitted = false;
  try {
    const target = new URL(expectedUrl);
    if (target.origin !== 'https://gemini.google.com' || target.pathname !== '/app' || target.search || target.hash) return attention('新しいGeminiチャットを特定できません。写真は送信していません。');
    expectedPath = target.pathname;
  } catch {return attention('チャットのURLが正しくありません。写真は送信していません。');}
  const allowed = () => {
    if (window !== window.top || location.origin !== 'https://gemini.google.com') return false;
    if (!submitted) return location.pathname === expectedPath;
    if (boundPath) return location.pathname === boundPath;
    if (/^\/app\/[a-zA-Z0-9_-]+$/.test(location.pathname)) {boundPath = location.pathname; return true;}
    return location.pathname === expectedPath;
  };
  const getMarker = () => {
    try {return JSON.parse(document.documentElement.dataset[markerKey] || 'null');} catch {return null;}
  };
  const setMarker = (marker) => {document.documentElement.dataset[markerKey] = JSON.stringify(marker);};
  const heartbeat = setInterval(() => {
    try {chrome.runtime.sendMessage({channel: 'crystal-quest-driver', type: 'HEARTBEAT', requestId, photoRequestId, stage: phase === 'send' ? 'generating' : 'photo_preparing'}).catch(() => {});} catch { /* Extension can be reloaded while the chat stays open. */ }
  }, 10_000);

  function questContext() {return allowed() && users().length === 0 && models().length === 0 && !generating();}

  function composer(editor) {
    return editor.closest('input-area-v2, input-container, input-area, .input-area-container, .input-container, form') || root();
  }

  function fileCandidates() {
    const inputs = nodes(['input[type="file"]'], document, false).filter((input) => !input.disabled);
    const imageOnly = inputs.filter((input) => /image\//i.test(input.getAttribute('accept') || ''));
    return imageOnly.length ? imageOnly : inputs.filter((input) => !input.getAttribute('accept') || /\.(png|jpe?g|webp)/i.test(input.getAttribute('accept')));
  }

  const verifiedPreviews = new Map();
  async function previewMatches(image, marker) {
    const source = image.currentSrc || image.src;
    if (!/^blob:https:\/\/gemini\.google\.com\//.test(source) || !/^[a-f0-9]{64}$/.test(marker.digest || '')) return false;
    const cacheKey = `${source}:${marker.digest}`;
    if (verifiedPreviews.has(cacheKey)) return verifiedPreviews.get(cacheKey);
    try {
      const response = await fetch(source, {signal: AbortSignal.timeout(3000)});
      const blob = await response.blob();
      if (blob.size !== marker.size) return false;
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const matches = digest === marker.digest;
      verifiedPreviews.set(cacheKey, matches);
      return matches && (image.currentSrc || image.src) === source && visible(image);
    } catch {return false;}
  }

  async function attachment(editor, marker) {
    const scope = composer(editor);
    const images = nodes(['img'], scope).filter((image) => image.complete && image.naturalWidth > 0);
    const removes = nodes(['button[aria-label*="削除"]', 'button[aria-label*="取り除"]', 'button[aria-label="添付ファイルを閉じる"]', 'button[aria-label*="Remove"]', 'button[aria-label*="remove"]', 'button[aria-label="Close attachment"]'], scope);
    const previews = nodes(['uploader-file-preview', 'file-preview', '.file-preview', '.image-preview', '[data-test-id="file-preview"]'], scope);
    const progress = nodes(['[role="progressbar"]', 'mat-progress-spinner', '[aria-busy="true"]'], scope);
    const nameSeen = normalize(scope.innerText).includes(marker.name) || images.some((image) => ['alt', 'title', 'aria-label'].some((attribute) => String(image.getAttribute(attribute) || '').includes(marker.name))) || removes.some((button) => String(button.getAttribute('aria-label') || '').includes(marker.name));
    const fileMatch = fileCandidates().some((input) => input.files?.length === 1 && input.files[0].name === marker.name && input.files[0].size === marker.size && input.files[0].type === marker.mime);
    const previewSource = images.length === 1 ? images[0].currentSrc || images[0].src : '';
    const byteMatch = images.length === 1 && !nameSeen && !fileMatch && await previewMatches(images[0], marker);
    // Confirm a visible preview and removal control, not merely input.files.
    // Both a filename/metadata match and an upload-complete UI are required.
    return {ready: images.length === 1 && removes.length === 1 && visible(images[0]) && visible(removes[0]) && (images[0].currentSrc || images[0].src) === previewSource && !progress.length && !nodes(['[role="progressbar"]', 'mat-progress-spinner', '[aria-busy="true"]'], scope).length && (nameSeen || fileMatch || byteMatch), count: Math.max(images.length, previews.length), scope, image: images[0], previewSource};
  }

  function fill(editor, text) {
    editor.focus();
    let inputDispatched = false;
    if (typeof editor.value === 'string') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(editor, text);
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
      const inserted = document.execCommand('insertText', false, text);
      inputDispatched = inserted;
      if (!inserted && !normalize(editorText(editor))) editor.textContent = text;
    }
    if (!inputDispatched) editor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
    return normalize(editorText(editor)) === normalize(text);
  }

  function clearSentDraft(editor) {
    // Only clear our exact already-sent instruction after the completed output
    // is confirmed. Preserve a user's new draft or attachment without changes.
    if (!allowed() || !editor.isConnected || normalize(editorText(editor)) !== normalize(prompt)) return false;
    if (nodes(['img', 'uploader-file-preview', 'file-preview', '.file-preview', '[role="progressbar"]'], composer(editor)).length) return false;
    if (nodes(['button[aria-label="添付ファイルを閉じる"]', 'button[aria-label*="削除"]', 'button[aria-label*="Remove"]', 'button[aria-label="Close attachment"]'], composer(editor)).length) return false;
    editor.focus();
    if (typeof editor.value === 'string') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(editor, '');
      editor.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'deleteContentBackward', data: null}));
    } else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('delete', false)) return false;
    }
    return !normalize(editorText(editor));
  }

  try {
    if (!allowed()) return attention('別のGeminiチャットに切り替わっています。写真は送信していません。');
    if (!['prepare', 'send'].includes(phase) || typeof prompt !== 'string' || !prompt || typeof photoRequestId !== 'string' || !/^[\w-]{16,80}$/.test(photoRequestId)) return {status: 'failed', message: '写真送信のデータが正しくありません。'};
    if (!questContext()) return attention('新しい空のGeminiチャットを確認できません。既存の会話には写真を送信しません。');
    let foundEditors = editors();
    while (phase === 'prepare' && foundEditors.length === 0 && Date.now() - started < timeoutMs) {
      await sleep(200);
      if (!questContext()) return attention('入力画面の準備中に会話が変わりました。写真は送信していません。');
      foundEditors = editors();
    }
    if (foundEditors.length !== 1) return attention('写真を送る入力欄を1つに特定できません。');
    const editor = foundEditors[0];

    if (phase === 'prepare') {
      if (normalize(editorText(editor))) return attention('Geminiの入力欄に下書きがあります。上書きせず停止しました。');
      if (!photo || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mime) || !Number.isInteger(photo.size) || photo.size < 1 || photo.size > 8 * 1024 * 1024 || !/^[a-zA-Z0-9_.-]{1,100}$/.test(photo.name || '')) return {status: 'failed', message: '写真の形式またはサイズが正しくありません。'};
      const match = String(photo.dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match || match[1] !== photo.mime) return {status: 'failed', message: '写真データが正しくありません。'};
      const decoded = atob(match[2]);
      if (decoded.length !== photo.size) return {status: 'failed', message: '写真データのサイズが一致しません。'};
      const existing = getMarker();
      if (existing) return attention(existing.sent ? 'この写真は送信操作済みです。自動で再送しません。' : '別の写真送信の準備が残っています。Geminiを確認してください。');
      const composerImages = nodes(['img'], composer(editor));
      const composerRemoves = nodes(['button[aria-label*="削除"]', 'button[aria-label*="Remove"]', 'uploader-file-preview', '.file-preview'], composer(editor));
      if (composerImages.length || composerRemoves.length) return attention('Geminiに別の添付があります。置き換えず停止しました。');
      const inputs = fileCandidates();
      if (inputs.length > 1) return attention('写真用のファイル入力を1つに特定できません。');
      const file = new File([Uint8Array.from(decoded, (character) => character.charCodeAt(0))], photo.name, {type: photo.mime});
      const transfer = new DataTransfer(); transfer.items.add(file);
      if (inputs.length === 1) {
        inputs[0].files = transfer.files;
        if (inputs[0].files.length !== 1 || inputs[0].files[0].size !== photo.size) return attention('写真の添付を確認できません。');
        inputs[0].dispatchEvent(new Event('change', {bubbles: true}));
      } else {
        // Current Gemini uses the native file picker without an input element.
        // Its image-paste UI accepts File objects directly. Dispatch once only;
        // a delayed upload must never trigger a second attachment attempt.
        editor.focus();
        editor.dispatchEvent(new ClipboardEvent('paste', {clipboardData: transfer, bubbles: true, cancelable: true}));
      }
      const marker = {requestId, photoRequestId, name: photo.name, size: photo.size, mime: photo.mime, digest: photoDigest, expectedPath, userCount: users().length, modelCount: models().length, sent: false};
      let readySince = null;
      let messageFilled = false;
      while (Date.now() - started < timeoutMs) {
        if (!questContext() || !editor.isConnected) return attention('添付中に会話が変わりました。自動送信は行いません。');
        const state = await attachment(editor, marker);
        if (!questContext() || !editor.isConnected) return attention('添付確認中に会話が変わりました。自動送信は行いません。');
        if (state.count > 1) return attention('添付画像が複数あります。自動送信は行いません。');
        if (state.ready) readySince ??= Date.now(); else readySince = null;
        if (readySince && Date.now() - readySince >= 800) {
          if (!messageFilled && normalize(editorText(editor))) return attention('添付中に下書きが入力されました。上書きせず停止しました。');
          if (!messageFilled && !fill(editor, prompt)) return attention('写真と一緒に送る指示の入力を確認できません。');
          messageFilled = true;
          if (normalize(editorText(editor)) !== normalize(prompt)) return attention('送信内容が変更されています。自動送信は行いません。');
          const buttons = sendButtons();
          if (buttons.length === 1 && enabled(buttons[0])) {
            setMarker(marker);
            return {status: 'photo_ready', message: '写真1枚の添付と送信内容を確認しました。', photoAttachmentConfirmed: true};
          }
        }
        await sleep(200);
      }
      return attention('写真のアップロード完了を確認できませんでした。自動送信は行っていません。');
    }

    const marker = getMarker();
    if (!marker || marker.sent || marker.requestId !== requestId || marker.photoRequestId !== photoRequestId || marker.digest !== photoDigest || marker.expectedPath !== expectedPath || marker.userCount !== users().length || marker.modelCount !== models().length) return attention('この写真の送信準備を確認できません。自動再送は行いません。');
    const preparedAttachment = await attachment(editor, marker);
    if (!allowed() || !questContext() || !editor.isConnected || normalize(editorText(editor)) !== normalize(prompt) || !preparedAttachment.ready || (preparedAttachment.image.currentSrc || preparedAttachment.image.src) !== preparedAttachment.previewSource) return attention('写真・会話・送信内容が変更されています。自動送信を中止しました。');
    const buttons = sendButtons();
    if (buttons.length !== 1 || !enabled(buttons[0])) return attention('写真を送信するボタンを確認できません。');
    // This supplement prevents repeat clicks within the same DOM too. The
    // worker's durable submit boundary remains the source of replay safety.
    setMarker({...marker, sent: true});
    submitted = true;
    buttons[0].click();
    let submissionConfirmed = false;
    let imageSince = null;
    let replySeen = false;
    let replyStableSince = null;
    let lastReply = '';
    while (Date.now() - started < timeoutMs) {
      if (!allowed()) return attention('送信後に別の会話へ切り替わりました。元のGeminiで結果を確認してください。', {photoSubmissionConfirmed: submissionConfirmed});
      const latestUsers = users();
      const newUsers = latestUsers.slice(marker.userCount);
      if (newUsers.length > 1) return attention('送信後に別のメッセージが追加されました。Geminiで結果を確認してください。', {photoSubmissionConfirmed: submissionConfirmed});
      const userPhotos = newUsers.length === 1 ? uniqueImages(nodes(['img'], newUsers[0]).filter((image) => {
        const rect = image.getBoundingClientRect();
        return image.complete && image.naturalWidth > 0 && rect.width >= 48 && rect.height >= 48 && Boolean(image.currentSrc || image.src);
      })) : [];
      submissionConfirmed ||= newUsers.length === 1 && normalize(userText(newUsers[0])) === normalize(prompt) && userPhotos.length === 1;
      const newModels = models().slice(marker.modelCount);
      const outputs = uniqueImages(newModels.flatMap(imageNodes));
      if (outputs.length > 1) return attention('画像が複数生成されました。Geminiで結果を確認してください。', {photoSubmissionConfirmed: submissionConfirmed, imageCount: outputs.length});
      const reply = normalize(newModels.map((node) => node.innerText).join('\n'));
      if (submissionConfirmed && /(?:画像(?:を|の)?生成(?:は|が|を)?できません|画像(?:を|の)?生成に失敗|画像生成の上限|使用量の上限|本日の上限|unable to generate|couldn.t generate|can.t generate|image generation failed|limit.{0,30}reached|reached.{0,30}limit)/i.test(reply) && !generating()) {
        return attention('写真は送信されましたが、Geminiが画像生成のエラーまたは上限を表示しました。自動再送は行いません。', {photoSubmissionConfirmed: true, imageCount: outputs.length});
      }
      replySeen ||= Boolean(reply);
      if (reply && reply === lastReply && !generating()) replyStableSince ??= Date.now(); else replyStableSince = null;
      lastReply = reply;
      if (submissionConfirmed && outputs.length === 1 && !generating()) imageSince ??= Date.now(); else imageSince = null;
      if (imageSince && Date.now() - imageSince >= 2000 && boundPath) {
        let draftCleared = false;
        try {draftCleared = clearSentDraft(editor);} catch { /* Draft cleanup must not turn a confirmed image into failure. */ }
        return {status: 'completed', message: '戦闘シーンの画像1枚の生成を確認しました。Geminiで画像を保存できます。', imageCount: 1, photoSubmissionConfirmed: true, url: `https://gemini.google.com${boundPath}`, draftCleared};
      }
      if (submissionConfirmed && !outputs.length && replyStableSince && Date.now() - replyStableSince >= 12_000) return attention('写真の送信を確認しましたが、画像は生成されていません。Geminiの返答や利用上限を確認してください。', {photoSubmissionConfirmed: true, imageCount: 0});
      await sleep(400);
    }
    return attention(submissionConfirmed ? replySeen ? '写真は送信されましたが、画像生成の完了を確認できません。Geminiの返答を確認してください。' : '写真の送信を確認しました。画像生成の確認がタイムアウトしたため、Geminiを確認してください。' : '写真の送信結果を確認できません。二重送信を避けるため再送しません。', {photoSubmissionConfirmed: submissionConfirmed, imageCount: 0});
  } catch {
    return attention(phase === 'send' ? '写真の送信結果を確認できません。自動再送は行いません。Geminiを確認してください。' : '写真の添付を完了できませんでした。送信は行っていません。');
  } finally {clearInterval(heartbeat);}
}
