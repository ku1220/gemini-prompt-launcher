import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLocalHandler} from '../scripts/local.mjs';

async function request(url, {method = 'GET', host = '127.0.0.1:4174', origin} = {}) {
  let result;
  const res = {writeHead(code, headers) {result = {code, headers}; return this;}, end(body) {result.body = body?.toString() || '';}};
  await createLocalHandler('/example/extension')({method, url, headers: {host, ...(origin ? {origin} : {})}}, res);
  return result;
}

test('local server only serves allowlisted files, not repository files', async () => {
  assert.equal((await request('/')).code, 200);
  assert.equal((await request('/assets/quest.js')).code, 200);
  for (const path of ['/.git/config', '/package.json', '/../package.json', '/assets/../README.md', '/%2e%2e/README.md', '/local/extension/worker.js']) assert.equal((await request(path)).code, 404);
});
test('rejects non-loopback Host, foreign Origin and writes', async () => {
  assert.equal((await request('/', {host: 'evil.example:4174'})).code, 403);
  assert.equal((await request('/', {origin: 'https://evil.example'})).code, 403);
  assert.equal((await request('/', {origin: 'http://127.0.0.1:4174.evil.example'})).code, 403);
  assert.equal((await request('/', {method: 'POST'})).code, 405);
  assert.equal((await request('http://evil.example/')).code, 403);
});
test('local metadata and responses prevent embedding and content sniffing', async () => {
  const result = await request('/local-info.json');
  assert.deepEqual(JSON.parse(result.body), {extensionPath: '/example/extension', version: '1.1.0'});
  assert.equal(result.headers['X-Frame-Options'], 'DENY');
  assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(result.headers['Access-Control-Allow-Origin'], undefined);
  assert.match(result.headers['Content-Security-Policy'], /img-src 'self' blob: data:/);
  assert.equal(result.headers['Permissions-Policy'], 'camera=(self), microphone=(), geolocation=()');
  assert.equal((await request('/', {method: 'HEAD'})).body, '');
});
test('extension permissions stay limited to Gemini and loopback bridge', async () => {
  const manifest = JSON.parse(await readFile(new URL('../local/extension/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.host_permissions, ['https://gemini.google.com/*']);
  assert.deepEqual(manifest.permissions, ['scripting', 'storage']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['http://127.0.0.1/*']);
  assert.equal(manifest.externally_connectable, undefined);
});
