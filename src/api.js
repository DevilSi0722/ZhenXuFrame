let cloudMode = false;
export function setCloudMode(value) { cloudMode = !!value; }
export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let data;
  try { data = await response.json(); } catch { throw new Error(`服务暂不可用 (${response.status})，请稍后重试`); }
  if (response.status === 401 && path !== '/login') window.dispatchEvent(new Event('frame-session-expired'));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}
export const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export function readDraft() {
  try { return JSON.parse(localStorage.getItem('frame-draft-v1')) || {}; } catch { return {}; }
}
export function saveDraft(draft) {
  try { const { images, ...text } = draft; localStorage.setItem('frame-draft-v1', JSON.stringify(text)); } catch { /* Draft storage may be disabled. */ }
}
export async function fileData(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('仅支持 PNG、JPEG、WebP 图片');
  if (file.size > 10 * 1024 * 1024) throw new Error('单张参考图请控制在 10 MB 以内');
  if (cloudMode) {
    const { upload } = await import('@vercel/blob/client');
    const ext = file.type.split('/')[1];
    const pathname = `references/${crypto.randomUUID()}.${ext}`;
    await upload(pathname, file, { access: 'private', handleUploadUrl: '/api/upload', contentType: file.type, multipart: file.size > 4 * 1024 * 1024 });
    return { name: file.name, value: `https://frame-reference.invalid/${pathname}` };
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, value: reader.result });
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}
export function imageSource(value) {
  return value.startsWith('https://frame-reference.invalid/') ? `/api/references?path=${encodeURIComponent(value.slice('https://frame-reference.invalid/'.length))}` : value;
}
