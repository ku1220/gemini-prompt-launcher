import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {prepareLocalExtension} from './prepare-local.mjs';

export const LOCAL_ORIGIN = 'http://127.0.0.1:4174';
const webRoot = new URL('../local/web/', import.meta.url);
const assets = new URL('../dist/', import.meta.url);
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
};
const routes = new Map([
  ['/', [new URL('index.html', webRoot), 'text/html; charset=utf-8']],
  ['/local.js', [new URL('local.js', webRoot), 'text/javascript; charset=utf-8']],
  ['/camera.js', [new URL('camera.js', webRoot), 'text/javascript; charset=utf-8']],
  ['/assets/local-prompt.js', [new URL('../local/extension/local-prompt.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/local.css', [new URL('local.css', webRoot), 'text/css; charset=utf-8']],
  ...['styles.css', 'quest.js', 'icon.svg', 'crystal.svg'].map((file) => [`/assets/${file}`, [new URL(file, assets), file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8']]),
]);

export function createLocalHandler(extensionPath) {
  return async (req, res) => {
    const reply = (code, type, body) => {res.writeHead(code, {...headers, 'Content-Type': type}); res.end(req.method === 'HEAD' ? undefined : body);};
    if (req.headers.host !== '127.0.0.1:4174') return reply(403, 'text/plain', 'Invalid host');
    if (req.headers.origin && req.headers.origin !== LOCAL_ORIGIN) return reply(403, 'text/plain', 'Invalid origin');
    if (!['GET', 'HEAD'].includes(req.method)) return reply(405, 'text/plain', 'Method not allowed');
    let url;
    try {url = new URL(req.url, LOCAL_ORIGIN);} catch {return reply(400, 'text/plain', 'Bad URL');}
    if (url.origin !== LOCAL_ORIGIN) return reply(403, 'text/plain', 'Invalid URL');
    if (url.pathname === '/local-info.json') return reply(200, 'application/json; charset=utf-8', JSON.stringify({extensionPath, version: '1.2.0'}));
    const route = routes.get(url.pathname);
    if (!route) return reply(404, 'text/plain', 'Not found');
    try {return reply(200, route[1], await readFile(route[0]));} catch {return reply(500, 'text/plain', 'Local file unavailable');}
  };
}

export async function startLocal() {
  const extensionPath = await prepareLocalExtension();
  const server = http.createServer(createLocalHandler(extensionPath));
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `${LOCAL_ORIGIN} は使用中です。既に起動していれば、その画面を使ってください。` : `起動できませんでした: ${error.code}`);
    process.exitCode = 1;
  });
  server.listen(4174, '127.0.0.1', () => {
    console.log(`CRYSTAL QUEST LOCAL: ${LOCAL_ORIGIN}/`);
    console.log(`Chromeで読み込む拡張機能: ${extensionPath}`);
    console.log('終了するには Ctrl+C を押すか、このターミナルを閉じてください。');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {server.close(); server.closeAllConnections();});
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await startLocal();
