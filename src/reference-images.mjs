import { IMAGE_BINARY_BUDGET, MAX_REQUEST_BYTES } from '../shared/limits.mjs';

const dataBytes = value => Math.ceil((value.split(',')[1]?.length || 0) * 3 / 4);
async function compress(value, limit) {
  if (dataBytes(value) <= limit) return value;
  const blob = await (await fetch(value)).blob();
  // Image decoding via <img> works in Safari as well as Chromium.
  const image = new Image();
  const url = URL.createObjectURL(blob);
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('参考图解码失败，请重新选择图片')); image.src = url; });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持参考图压缩');
    let edge = Math.min(1920, Math.max(image.naturalWidth, image.naturalHeight));
    while (edge >= 256) {
      const scale = edge / Math.max(image.naturalWidth, image.naturalHeight);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.88, 0.76, 0.62, 0.48]) {
        const result = canvas.toDataURL('image/jpeg', quality);
        if (dataBytes(result) <= limit) return result;
      }
      edge = Math.floor(edge * 0.75);
    }
    throw new Error('参考图片压缩后仍过大，请减少图片数量或使用图片直链');
  } finally { URL.revokeObjectURL(url); }
}
export async function prepareCloudPayload(payload, compressImage = compress) {
  const images = payload.images || [];
  const files = images.filter(value => value.startsWith('data:'));
  const limit = Math.floor(IMAGE_BINARY_BUDGET / Math.max(1, files.length));
  const prepared = [];
  // Sequential decoding keeps memory bounded when nine large reference images are selected.
  for (const value of images) prepared.push(value.startsWith('data:') ? await compressImage(value, limit) : value);
  const result = { ...payload, ...(images.length ? { images: prepared } : {}) };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_REQUEST_BYTES - 1024) throw new Error('参考图和提示词总大小超过提交限制，请减少图片或使用图片直链');
  return result;
}
