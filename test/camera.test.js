import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraCapture, fitDimensions, assertPhotoFile, cameraError, MAX_PHOTO_BYTES} from '../local/web/camera.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {resolve = done;});
  return {promise, resolve};
}

function stream(id = 'camera-one') {
  const track = {stops: 0, stop() {this.stops++;}, getSettings: () => ({deviceId: id})};
  return {track, getTracks: () => [track], getVideoTracks: () => [track]};
}

function harness({getUserMedia, enumerateDevices, decodeImage, encodePhoto} = {}) {
  const events = [];
  const photos = [];
  const requests = [];
  const draws = [];
  const blobs = [];
  const created = [];
  const revoked = [];
  const deviceStream = stream();
  const video = Object.assign(new EventTarget(), {videoWidth: 1280, videoHeight: 720, readyState: 2, srcObject: null, play: async () => {}});
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({fillRect() {}, drawImage(...args) {draws.push(args);}}),
    toBlob(done, mime, quality) {
      blobs.push({mime, quality});
      done(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], {type: mime}));
    },
  };
  const mediaDevices = {
    async getUserMedia(options) {requests.push(options); return getUserMedia ? getUserMedia(options) : deviceStream;},
    enumerateDevices: enumerateDevices || (async () => [{kind: 'videoinput', deviceId: 'camera-one', label: '内蔵カメラ'}, {kind: 'audioinput', deviceId: 'microphone'}]),
  };
  const urls = {createObjectURL(blob) {const url = `blob:test-photo-${created.length}`; created.push({url, blob}); return url;}, revokeObjectURL(url) {revoked.push(url);}};
  const camera = new CameraCapture({video, canvas, mediaDevices, urls, ...(decodeImage ? {decodeImage} : {}), ...(encodePhoto ? {encodePhoto} : {}), onState: (event) => events.push(event), onPhoto: (photo) => photos.push(photo)});
  return {camera, video, canvas, events, photos, requests, draws, blobs, created, revoked, deviceStream};
}

test('photos fit within 1600 pixels without upscaling or losing aspect ratio', () => {
  assert.deepEqual(fitDimensions(4000, 3000), {width: 1600, height: 1200});
  assert.deepEqual(fitDimensions(720, 1280), {width: 720, height: 1280});
  assert.deepEqual(fitDimensions(2000, 4000), {width: 800, height: 1600});
  for (const size of [[0, 10], [-1, 10], [NaN, 10], [10, Infinity]]) assert.throws(() => fitDimensions(...size));
});

test('file input accepts only bounded JPEG, PNG and WebP photos', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.doesNotThrow(() => assertPhotoFile({type, size: MAX_PHOTO_BYTES}));
  for (const file of [null, {type: 'image/svg+xml', size: 100}, {type: 'text/html', size: 100}, {type: 'image/jpeg', size: 0}, {type: 'image/png', size: MAX_PHOTO_BYTES + 1}, {type: 'image/jpeg', size: Infinity}]) assert.throws(() => assertPhotoFile(file));
});

test('camera requests video only and lists only video devices after permission', async () => {
  const h = harness();
  assert.equal(await h.camera.start('camera-one'), true);
  assert.equal(h.requests[0].audio, false);
  assert.deepEqual(h.requests[0].video.deviceId, {exact: 'camera-one'});
  assert.equal(h.video.srcObject, h.deviceStream);
  assert.equal(h.camera.state, 'live');
  assert.deepEqual(h.events.at(-1).devices.map((device) => device.kind), ['videoinput']);
  h.camera.destroy();
  assert.equal(h.deviceStream.track.stops, 1);
  assert.equal(h.video.srcObject, null);
});

test('late camera permission after stop cannot leave the camera running', async () => {
  const permission = deferred();
  const lateStream = stream();
  const h = harness({getUserMedia: () => permission.promise});
  const opening = h.camera.start();
  h.camera.stop();
  permission.resolve(lateStream);
  assert.equal(await opening, false);
  assert.equal(lateStream.track.stops, 1);
  assert.equal(h.video.srcObject, null);
  assert.equal(h.camera.state, 'idle');
  assert.equal(h.camera.photo, null);
});

test('switching cameras stops the old stream and keeps the selected new stream', async () => {
  const first = stream('first');
  const second = stream('second');
  const h = harness({getUserMedia: ({video}) => video.deviceId.exact === 'first' ? first : second});
  await h.camera.start('first');
  await h.camera.start('second');
  assert.equal(first.track.stops, 1);
  assert.equal(second.track.stops, 0);
  assert.equal(h.video.srcObject, second);
  h.camera.stop();
  assert.equal(second.track.stops, 1);
});

test('a late first camera cannot replace the newer selected camera', async () => {
  const permission = deferred();
  const oldStream = stream('first');
  const newStream = stream('second');
  const h = harness({getUserMedia: ({video}) => video.deviceId.exact === 'first' ? permission.promise : newStream});
  const oldOpening = h.camera.start('first');
  assert.equal(await h.camera.start('second'), true);
  permission.resolve(oldStream);
  assert.equal(await oldOpening, false);
  assert.equal(oldStream.track.stops, 1);
  assert.equal(newStream.track.stops, 0);
  assert.equal(h.video.srcObject, newStream);
  assert.equal(h.camera.state, 'live');
  h.camera.destroy();
});

test('permission denial and missing devices report usable errors and create no photo', async () => {
  for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError']) {
    const h = harness({getUserMedia: async () => {throw Object.assign(new Error('raw browser error'), {name});}});
    assert.equal(await h.camera.start(), false);
    assert.equal(h.camera.state, 'error');
    assert.equal(h.events.at(-1).message, cameraError({name}));
    assert.equal(h.camera.photo, null);
    assert.equal(h.video.srcObject, null);
  }
});

test('capture is blocked before a usable video frame exists', async () => {
  const h = harness();
  assert.equal(await h.camera.capture(), false);
  await h.camera.start();
  h.video.videoWidth = 0;
  assert.equal(await h.camera.capture(), false);
  assert.equal(h.draws.length, 0);
  assert.equal(h.camera.photo, null);
  h.camera.destroy();
});

test('capture stops the camera and prepares an unmirrored JPEG with an ASCII name', async () => {
  const h = harness();
  await h.camera.start();
  h.video.videoWidth = 4000; h.video.videoHeight = 3000;
  assert.equal(await h.camera.capture(), true);
  assert.equal(h.deviceStream.track.stops, 1);
  assert.equal(h.video.srcObject, null);
  assert.equal(h.camera.state, 'photo');
  assert.equal(h.canvas.width, 1600); assert.equal(h.canvas.height, 1200);
  assert.deepEqual(h.draws[0].slice(1), [0, 0, 1600, 1200]);
  assert.deepEqual(h.blobs[0], {mime: 'image/jpeg', quality: 0.9});
  assert.equal(h.camera.photo.mime, 'image/jpeg');
  assert.match(h.camera.photo.name, /^[a-zA-Z0-9_.-]+\.jpg$/);
  assert.match(h.camera.photo.dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(Buffer.from(h.camera.photo.dataUrl.split(',')[1], 'base64').byteLength, h.camera.photo.size);
  const preview = h.camera.previewUrl;
  h.camera.clearPhoto();
  assert.equal(h.camera.photo, null);
  assert.equal(h.camera.previewUrl, null);
  assert.deepEqual(h.revoked, [preview]);
  h.camera.destroy();
  assert.deepEqual(h.revoked, [preview]);
});

test('stopping during asynchronous image encoding discards the stale captured photo', async () => {
  const encoding = deferred();
  const h = harness({encodePhoto: () => encoding.promise});
  await h.camera.start();
  const capturing = h.camera.capture();
  await Promise.resolve();
  h.camera.stop();
  encoding.resolve({dataUrl: 'unused', mime: 'image/jpeg', size: 1, name: 'photo.jpg'});
  assert.equal(await capturing, false);
  assert.equal(h.camera.photo, null);
  assert.equal(h.created.length, 0);
});

test('stopping during file decode invalidates the late result without drawing or storing it', async () => {
  const decoding = deferred();
  const h = harness({decodeImage: () => decoding.promise});
  const importing = h.camera.setFile(new Blob(['image'], {type: 'image/png'}));
  h.camera.stop();
  decoding.resolve({width: 1000, height: 700});
  assert.equal(await importing, false);
  assert.equal(h.draws.length, 0);
  assert.equal(h.camera.photo, null);
  assert.equal(h.created.length, 0);
});

test('saved images are decoded and resized rather than forwarding original bytes or filenames', async () => {
  const h = harness({decodeImage: async () => ({naturalWidth: 3000, naturalHeight: 2000})});
  const file = new Blob(['original png with metadata'], {type: 'image/png'});
  file.name = '個人名入り写真.png';
  assert.equal(await h.camera.setFile(file), true);
  assert.equal(h.camera.photo.mime, 'image/jpeg');
  assert.equal(h.camera.photo.name, 'crystal-quest-photo.jpg');
  assert.equal(h.canvas.width, 1600); assert.equal(h.canvas.height, 1067);
  assert.equal(h.requests.length, 0);
  assert.equal(h.created.length, 1);
  h.camera.destroy();
  assert.equal(h.revoked.length, 1);
});

test('oversized resolution is rejected before canvas allocation', async () => {
  const h = harness({decodeImage: async () => ({naturalWidth: 10000, naturalHeight: 5000})});
  assert.equal(await h.camera.setFile(new Blob(['image'], {type: 'image/jpeg'})), false);
  assert.equal(h.camera.state, 'error');
  assert.equal(h.draws.length, 0);
  assert.equal(h.camera.photo, null);
});
