import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MAX_PHOTO_BYTES, conversationUrl, validatePhoto} from '../local/extension/photo-contract.js';

const photoRequestId = 'photo-request-00000001';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 8, 1, 2, 3, 0xff, 0xd9]);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP')]);
function photo(mime = 'image/jpeg', bytes = jpeg) {
  return {mime, size: bytes.length, name: '../../untrusted-file-name.svg', dataUrl: `data:${mime};base64,${bytes.toString('base64')}`};
}

test('photo contract accepts the three explicit image MIME types and generates its own filename', async () => {
  for (const [mime, bytes, extension] of [['image/jpeg', jpeg, 'jpg'], ['image/png', png, 'png'], ['image/webp', webp, 'webp']]) {
    const result = await validatePhoto(photo(mime, bytes), 'flare', photoRequestId);
    assert.equal(result.photo.mime, mime);
    assert.equal(result.photo.size, bytes.length);
    assert.equal(result.photo.name, `crystal-quest-flare-${photoRequestId.slice(0, 8)}.${extension}`);
    assert.equal(result.metadata.photoDigest, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(Object.hasOwn(result.metadata, 'dataUrl'), false);
  }
});

test('photo digest binds the bytes while request IDs affect only the safe filename', async () => {
  const first = await validatePhoto(photo(), 'ultima', photoRequestId);
  const sameBytes = await validatePhoto(photo(), 'ultima', 'different-request-00002');
  const changed = await validatePhoto(photo('image/jpeg', Buffer.concat([jpeg, Buffer.from([1])])), 'ultima', photoRequestId);
  assert.equal(first.metadata.photoDigest, sameBytes.metadata.photoDigest);
  assert.notEqual(first.photo.name, sameBytes.photo.name);
  assert.notEqual(first.metadata.photoDigest, changed.metadata.photoDigest);
});

test('photo contract rejects unsupported MIME and MIME/magic disagreement', async () => {
  for (const invalid of [null, {}, photo('image/svg+xml'), photo('text/plain'), photo('image/png', jpeg), photo('image/webp', png), photo('image/jpeg', Buffer.from('not-an-image'))]) {
    await assert.rejects(validatePhoto(invalid, 'ultima', photoRequestId));
  }
});

test('photo contract rejects malformed data URLs, base64 and byte-size mismatches', async () => {
  const valid = photo();
  const invalids = [
    {...valid, dataUrl: valid.dataUrl.replace('image/jpeg', 'image/png')},
    {...valid, dataUrl: valid.dataUrl.replace(';base64,', ',')},
    {...valid, dataUrl: valid.dataUrl + '\n'},
    {...valid, dataUrl: valid.dataUrl.slice(0, -1) + '!'},
    {...valid, dataUrl: valid.dataUrl.slice(0, -1)},
    {...valid, dataUrl: valid.dataUrl + '='},
    {...valid, size: valid.size + 1},
    {...valid, size: valid.size - 1},
    {...valid, size: 0},
    {...valid, size: -1},
    {...valid, size: 1.5},
    {...valid, size: '11'},
    {...valid, size: MAX_PHOTO_BYTES + 1},
  ];
  for (const invalid of invalids) await assert.rejects(validatePhoto(invalid, 'ultima', photoRequestId));
});

test('photo contract accepts the full 8 MiB boundary without regular-expression stack overflow', async () => {
  const bytes = Buffer.alloc(MAX_PHOTO_BYTES);
  jpeg.copy(bytes);
  const result = await validatePhoto(photo('image/jpeg', bytes), 'ultima', photoRequestId);
  assert.equal(result.photo.size, MAX_PHOTO_BYTES);
  assert.equal(result.metadata.photoDigest, createHash('sha256').update(bytes).digest('hex'));
});

test('conversation URLs retain exactly the Gemini conversation identity', () => {
  assert.equal(conversationUrl('https://gemini.google.com/app/abc123_-?query=ignored#ignored'), 'https://gemini.google.com/app/abc123_-');
  for (const value of [
    null, '', 'not-a-url',
    'http://gemini.google.com/app/abc',
    'https://gemini.google.com.evil.example/app/abc',
    'https://evil.example/app/abc',
    'https://gemini.google.com:8443/app/abc',
    'https://gemini.google.com/app',
    'https://gemini.google.com/app/',
    'https://gemini.google.com/app/abc/',
    'https://gemini.google.com/app/abc/def',
    'https://gemini.google.com/app/%61bc',
  ]) assert.equal(conversationUrl(value), null, String(value));
});
