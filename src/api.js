let cloudMode = false;
let browserJobs;
async function browserService() {
  if (!browserJobs) {
    const { createBrowserJobs } = await import('./browser-jobs.mjs');
    browserJobs ||= createBrowserJobs({ request: networkApi, changed: () => window.dispatchEvent(new Event('frame-jobs-changed')) });
  }
  return browserJobs;
}
export function setCloudMode(value) { cloudMode = !!value; }
export const usesBrowserStorage = () => cloudMode;
export async function api(path, options = {}) {
  if (cloudMode && (path === '/jobs' || path.startsWith('/jobs/') || path.startsWith('/jobs?'))) return (await browserService()).route(path, options);
  return networkApi(path, options);
}
async function networkApi(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let data;
  try { data = await response.json(); } catch { throw new Error(`服务暂不可用 (${response.status})，请稍后重试`); }
  if (response.status === 401 && path !== '/login') window.dispatchEvent(new Event('frame-session-expired'));
  if (!response.ok) throw Object.assign(new Error(data.error || `请求失败 (${response.status})`), { status: response.status, retryMs: data.retryMs });
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
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, value: reader.result });
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}
export function imageSource(value) {
  return value;
}
export async function exportBackup() {
  const service = await browserService();
  const backup = await service.backup();
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `frame-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return backup.jobs.length;
}
export async function importBackup(file) {
  if (file.size > 200 * 1024 * 1024) throw new Error('备份文件不能超过 200 MB');
  let value;
  try { value = JSON.parse(await file.text()); } catch { throw new Error('备份文件不是有效 JSON'); }
  const result = await (await browserService()).db.importBackup(value);
  window.dispatchEvent(new Event('frame-jobs-changed'));
  return result;
}
