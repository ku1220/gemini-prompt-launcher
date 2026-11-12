export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const PHOTO_MIMES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

export function fitDimensions(width, height, longest = 1600) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('写真の大きさを確認できませんでした。');
  const scale = Math.min(1, longest / Math.max(width, height));
  return {width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale))};
}

export function assertPhotoFile(file) {
  if (!file || !PHOTO_MIMES.includes(file.type)) throw new Error('JPEG・PNG・WebPの写真を選んでください。');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_PHOTO_BYTES) throw new Error('写真は8 MB以下のファイルを選んでください。');
}

export function cameraError(error) {
  const messages = {
    NotAllowedError: 'カメラの使用が許可されていません。ChromeのアドレスバーとMacのカメラ設定を確認するか、保存済みの写真を選んでください。',
    PermissionDeniedError: 'カメラの使用が許可されていません。保存済みの写真も使用できます。',
    NotFoundError: '接続されたカメラが見つかりません。USBカメラを接続するか、保存済みの写真を選んでください。',
    NotReadableError: 'カメラを起動できません。他のアプリが使用中の場合は閉じてから、もう一度お試しください。',
    OverconstrainedError: '選んだカメラを使用できません。別のカメラを選んでください。',
    SecurityError: 'この画面ではカメラを使用できません。ローカル起動画面をChromeで開いてください。',
  };
  return messages[error?.name] || error?.message || 'カメラを起動できませんでした。保存済みの写真も使用できます。';
}

async function blobToPhoto(blob) {
  assertPhotoFile(blob);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return {dataUrl: `data:${blob.type};base64,${btoa(binary)}`, mime: blob.type, size: blob.size, name: 'crystal-quest-photo.jpg'};
}

async function decodeImageBlob(blob, urls) {
  const source = urls.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    return image;
  } finally {
    urls.revokeObjectURL(source);
  }
}

// Camera and photo data live only in this page's memory. Dependencies are
// injectable so permission races and device cleanup can be tested without a camera.
export class CameraCapture {
  constructor({video, canvas, mediaDevices = globalThis.navigator?.mediaDevices, urls = URL, decodeImage = decodeImageBlob, encodePhoto = blobToPhoto, onState = () => {}, onPhoto = () => {}}) {
    Object.assign(this, {video, canvas, mediaDevices, urls, decodeImage, encodePhoto, onState, onPhoto});
    this.state = 'idle';
    this.photo = null;
    this.previewUrl = null;
    this._stream = null;
    this._version = 0;
  }

  _emit(state, detail = {}) {this.state = state; this.onState({state, ...detail});}

  _stopTracks() {
    for (const track of this._stream?.getTracks() || []) track.stop();
    this._stream = null;
    this.video.srcObject = null;
  }

  stop() {
    this._version++;
    this._stopTracks();
    this._emit(this.photo ? 'photo' : 'idle');
  }

  _clearPhoto() {
    if (this.previewUrl) this.urls.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
    this.photo = null;
    this.onPhoto(null);
  }

  clearPhoto() {this.stop(); this._clearPhoto(); this._emit('idle');}

  async start(deviceId = '') {
    this.stop();
    this._clearPhoto();
    const version = this._version;
    this._emit('requesting');
    try {
      if (!this.mediaDevices?.getUserMedia) throw Object.assign(new Error('カメラ機能を利用できません。Chromeでローカル画面を開くか、保存済みの写真を選んでください。'), {name: 'CameraUnavailable'});
      const stream = await this.mediaDevices.getUserMedia({audio: false, video: {...(deviceId ? {deviceId: {exact: deviceId}} : {}), width: {ideal: 1600}, height: {ideal: 1200}}});
      if (version !== this._version) {stream.getTracks().forEach((track) => track.stop()); return false;}
      this._stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      if (version !== this._version) return false;
      await this._waitForVideo(version);
      if (version !== this._version) return false;
      this._emit('live');
      try {
        const devices = (await this.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
        if (version === this._version) this._emit('live', {devices, deviceId: stream.getVideoTracks?.()[0]?.getSettings?.().deviceId || deviceId});
      } catch { /* Preview remains usable when device enumeration is unavailable. */ }
      return version === this._version;
    } catch (error) {
      if (version !== this._version) return false;
      this._stopTracks();
      this._emit('error', {message: cameraError(error)});
      return false;
    }
  }

  async _waitForVideo(version) {
    if (this.video.videoWidth > 0 && this.video.videoHeight > 0 && this.video.readyState >= 2) return;
    await new Promise((resolve, reject) => {
      const finish = () => {
        if (version !== this._version) {clean(); resolve();}
        else if (this.video.videoWidth > 0 && this.video.videoHeight > 0 && this.video.readyState >= 2) {clean(); resolve();}
      };
      const clean = () => {clearTimeout(timer); for (const event of events) this.video.removeEventListener(event, finish);};
      const events = ['loadedmetadata', 'loadeddata', 'playing', 'resize'];
      const timer = setTimeout(() => {clean(); reject(new Error('カメラの映像を確認できませんでした。別のカメラまたは保存済みの写真をお試しください。'));}, 8000);
      for (const event of events) this.video.addEventListener(event, finish);
      finish();
    });
  }

  _canvasBlob(source, width, height) {
    const size = fitDimensions(width, height);
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('撮影用の画面を準備できませんでした。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(source, 0, 0, size.width, size.height);
    return new Promise((resolve, reject) => this.canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('写真を保存できませんでした。もう一度撮影してください。')), 'image/jpeg', 0.9));
  }

  async _keepBlob(blob, version) {
    const photo = await this.encodePhoto(blob);
    if (version !== this._version) return false;
    const previewUrl = this.urls.createObjectURL(blob);
    this._clearPhoto();
    this.photo = photo;
    this.previewUrl = previewUrl;
    this.onPhoto(photo);
    this._emit('photo');
    return true;
  }

  async capture() {
    if (this.state !== 'live' || !this._stream || this.video.videoWidth <= 0 || this.video.videoHeight <= 0 || this.video.readyState < 2) return false;
    const version = this._version;
    this._emit('capturing');
    try {
      const promise = this._canvasBlob(this.video, this.video.videoWidth, this.video.videoHeight);
      this._stopTracks();
      return await this._keepBlob(await promise, version);
    } catch (error) {
      if (version === this._version) {this._stopTracks(); this._emit('error', {message: cameraError(error)});}
      return false;
    }
  }

  async setFile(file) {
    this.stop(); this._clearPhoto();
    const version = this._version;
    this._emit('capturing');
    try {
      assertPhotoFile(file);
      const image = await this.decodeImage(file, this.urls);
      if (version !== this._version) return false;
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (width * height > 40_000_000) throw new Error('写真の解像度が大きすぎます。小さい画像を選んでください。');
      return await this._keepBlob(await this._canvasBlob(image, width, height), version);
    } catch (error) {
      if (version === this._version) this._emit('error', {message: error?.name === 'EncodingError' ? '写真を読み込めませんでした。別のJPEG・PNG・WebP画像を選んでください。' : cameraError(error)});
      return false;
    }
  }

  destroy() {this.clearPhoto();}
}
