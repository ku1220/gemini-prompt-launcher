(() => {
  const origin = 'http://127.0.0.1:4174';
  if (location.origin !== origin || location.pathname !== '/' || window !== window.top) return;
  const channel = 'crystal-quest-local';
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== origin) return;
    const message = event.data;
    if (!message || message.channel !== channel || message.direction !== 'request') return;
    if (!['HELLO', 'QUEST_START', 'STATUS', 'OPEN_CHAT'].includes(message.type)) return;
    if (typeof message.rpcId !== 'string' || !/^[\w-]{1,80}$/.test(message.rpcId)) return;
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        channel, type: message.type, requestId: message.requestId, spellId: message.spellId,
        ...(message.type === 'QUEST_START' ? {photo: message.photo} : {}),
      });
    } catch {
      response = {ok: false, error: '拡張機能との接続が切れました。このページを再読み込みしてください。'};
    }
    window.postMessage({channel, direction: 'response', rpcId: message.rpcId, response}, origin);
  });
})();
