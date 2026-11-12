// This function is serialized by chrome.scripting.executeScript. Keep every
// dependency inside it; do not capture module variables or use remote code.
export async function runGeminiDriver(options) {
  const { phase, prompt, welcome, requestId } = options;
  const timeoutMs = Math.min(Number(options.timeoutMs) || 60_000, 90_000);
  const started = Date.now();
  // Gemini's rich editor can collapse empty paragraphs. Preserve every other
  // character while tolerating CRLF, NBSP and blank-line presentation changes.
  const normalize = (text) => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\n+/g, '\n').trim();
  const compact = (text) => normalize(text).replace(/\s+/g, '');
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  };
  const attention = (message, extra = {}) => ({ status: 'needs_attention', message, ...extra });
  const allowed = () => location.origin === 'https://gemini.google.com' && /^\/app(?:\/|$)/.test(location.pathname) && window === window.top;
  const root = () => document.querySelector('main, [role="main"]') || document.body;
  const uniqueVisible = (selectors) => [...new Set(selectors.flatMap((selector) => [...root().querySelectorAll(selector)]))].filter(visible);
  const editors = () => uniqueVisible([
    'rich-textarea [contenteditable="true"][role="textbox"]',
    '.ql-editor[contenteditable="true"]',
    'textarea[aria-label="Gemini に相談"]',
    'textarea[aria-label="Enter a prompt here"]'
  ]);
  const readEditor = (editor) => typeof editor.value === 'string' ? editor.value : editor.innerText;
  const hasAttachments = (editor) => {
    const area = editor.closest?.('input-area-v2, input-container, input-area, .input-area-container, .input-container, form');
    return area ? [...area.querySelectorAll('img, uploader-file-preview, file-preview, button[aria-label="添付ファイルを閉じる"], button[aria-label="Close attachment"]')].some(visible) : false;
  };
  const userBubbles = () => uniqueVisible(['user-query', '[data-test-id="user-query"]']);
  const responseTexts = () => {
    const blocks = uniqueVisible([
      'model-response .markdown',
      'model-response .model-response-text',
      '[data-test-id="model-response"] .markdown'
    ]);
    // The same text may match a wrapper and its nested markdown element.
    // Include every separate reply block, but count nested blocks only once.
    return blocks.filter((block) => !blocks.some((other) => other !== block && other.contains(block)));
  };
  const outputImages = () => uniqueVisible([
    'model-response img',
    'model-response canvas',
    'model-response video',
    '[data-test-id="model-response"] img'
  ]);
  const sendButtons = () => uniqueVisible([
    'button[aria-label="送信"]',
    'button[aria-label="プロンプトを送信"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]',
    'button.send-button',
    'button[data-test-id="send-button"]'
  ]);
  const enabled = (button) => !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  const generating = () => uniqueVisible([
    'button[aria-label="回答を停止"]',
    'button[aria-label="生成を停止"]',
    'button[aria-label="Stop response"]',
    'button[aria-label="Stop generating"]'
  ]).length > 0;
  const heartbeat = setInterval(() => {
    try {
      chrome.runtime.sendMessage({ channel: 'crystal-quest-driver', type: 'HEARTBEAT', requestId }).catch(() => {});
    } catch { /* The tab can remain open after the extension is reloaded. */ }
  }, 10_000);

  try {
    if (!allowed()) return attention('Geminiのチャット画面ではありません。自動送信を中止しました。');
    if (typeof prompt !== 'string' || !prompt || typeof welcome !== 'string' || !welcome) {
      return { status: 'failed', message: '起動データが正しくありません。' };
    }

    if (phase === 'prepare') {
      let editor;
      while (Date.now() - started < timeoutMs) {
        if (!allowed()) return attention('ページが切り替わったため、自動送信を中止しました。');
        const found = editors();
        if (found.length > 1) return attention('入力欄を1つに特定できませんでした。自動送信は行っていません。');
        if (found.length === 1) { editor = found[0]; break; }
        await sleep(300);
      }
      if (!editor) return attention('Geminiの入力欄を確認できませんでした。Chromeでログイン状態を確認してください。');
      if (userBubbles().length || responseTexts().length) return attention('新規チャットを確認できませんでした。既存の会話には送信していません。');
      if (hasAttachments(editor)) return attention('Geminiに別の添付があります。写真を含めずに開始するため、添付を確認してください。自動送信は行っていません。');
      const existing = normalize(readEditor(editor));
      if (existing && existing !== normalize(prompt)) return attention('入力欄に別の文章があります。上書きせずに停止しました。');

      editor.focus();
      // Gemini can restore a draft into a new tab. Reuse only a draft that
      // already matches this exact quest; never replace unrelated user input.
      if (!existing && typeof editor.value === 'string') {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (!setter) return attention('この入力欄には対応していません。');
        setter.call(editor, prompt);
      } else if (!existing) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
        const inserted = document.execCommand('insertText', false, prompt);
        if (!inserted && !normalize(readEditor(editor))) editor.textContent = prompt;
      }
      if (!existing) editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));

      while (Date.now() - started < timeoutMs) {
        if (!allowed() || !editor.isConnected) return attention('入力中に画面が切り替わりました。自動送信は行っていません。');
        if (normalize(readEditor(editor)) !== normalize(prompt)) {
          return attention('入力された全文の一致を確認できませんでした。自動送信は行っていません。');
        }
        const buttons = sendButtons();
        if (buttons.length > 1) return attention('送信ボタンを1つに特定できませんでした。自動送信は行っていません。');
        if (buttons.length === 1 && enabled(buttons[0])) return { status: 'ready', message: 'プロンプト全文の入力を確認しました。' };
        await sleep(250);
      }
      return attention('送信ボタンが有効になりませんでした。自動送信は行っていません。');
    }

    if (phase !== 'send') return { status: 'failed', message: '未対応の操作です。' };
    const foundEditors = editors();
    if (foundEditors.length !== 1 || hasAttachments(foundEditors[0]) || normalize(readEditor(foundEditors[0])) !== normalize(prompt)) {
      return attention('送信前の全文確認に失敗しました。自動送信を中止しました。');
    }
    if (userBubbles().length || responseTexts().length) return attention('新規チャットではないため、自動送信を中止しました。');
    const buttons = sendButtons();
    if (buttons.length !== 1 || !enabled(buttons[0])) return attention('送信ボタンを確認できませんでした。自動送信を中止しました。');

    // This is the only send action. The worker persists submitAttempted BEFORE
    // invoking this phase and never retries it, including after a restart.
    buttons[0].click();
    let submissionConfirmed = false;
    let replyObserved = false;
    let welcomeSince = null;
    while (Date.now() - started < timeoutMs) {
      if (!allowed()) return attention('送信後にページが切り替わりました。結果をGeminiで確認してください。', { submissionConfirmed });
      const bubbles = userBubbles();
      submissionConfirmed ||= bubbles.some((bubble) => compact(bubble.innerText).includes(compact(prompt)));
      const responses = responseTexts();
      replyObserved ||= responses.some((response) => normalize(response.innerText).length > 0);
      const welcomeMatched = compact(responses.map((response) => response.innerText).join('\n')) === compact(welcome) && outputImages().length === 0;
      if (welcomeMatched && !generating()) welcomeSince ??= Date.now();
      else welcomeSince = null;
      if (submissionConfirmed && welcomeSince && Date.now() - welcomeSince >= 1_200) {
        return { status: 'completed', message: '歓迎文の表示を確認しました。Geminiの「＋」から写真を送信してください。', submissionConfirmed: true, welcomeMatched: true };
      }
      await sleep(400);
    }
    return attention(
      submissionConfirmed
        ? replyObserved ? '送信を確認しましたが、指定の歓迎文とは一致しませんでした。Geminiの返答を確認してください。' : '送信を確認しました。返答の確認がタイムアウトしたため、Geminiを確認してください。'
        : '送信操作後の結果を確認できませんでした。重複送信を避けるため再送せず、Geminiを確認してください。',
      { submissionConfirmed, welcomeMatched: false }
    );
  } catch {
    return attention(phase === 'send' ? '送信結果を確認できませんでした。自動再送は行いません。Geminiを確認してください。' : '入力欄の操作を完了できませんでした。自動送信は行っていません。');
  } finally {
    clearInterval(heartbeat);
  }
}
