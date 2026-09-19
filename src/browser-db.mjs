import { buildPayload, publicUrl } from '../shared/models.mjs';
import { SUBMISSION_STALE_MS } from '../shared/limits.mjs';

const statuses = new Set(['submitting', 'unknown', 'queued', 'processing', 'in_progress', 'completed', 'succeeded', 'failed']);
export const uncertainMessage = '提交结果未能确认，未自动重提。请核对平台记录后导入任务 ID，避免重复费用。';
const storageError = error => new Error(error?.name === 'QuotaExceededError' ? '浏览器存储空间不足，请先导出备份并释放空间；未自动重新提交任务。' : `浏览器数据库不可用，请允许网站存储并退出无痕模式后重试。${error?.message || ''}`);
const cleanText = (value, max = 8000) => typeof value === 'string' ? value.slice(0, max) : '';

// Explicit field selection ensures imported/exported backups never include API keys.
export function cleanRecord(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(raw.id) || !Number.isFinite(Date.parse(raw.createdAt)) || !statuses.has(raw.status)) throw new Error('备份包含无效的任务记录');
  const base = new URL(raw.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('备份中的 API 地址无效');
  if (raw.remoteId && (typeof raw.remoteId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(raw.remoteId))) throw new Error('备份中的任务 ID 无效');
  const payload = raw.payload ? buildPayload(raw.payload) : undefined;
  const job = {
    id: raw.id, requestToken: cleanText(raw.requestToken, 80) || raw.id,
    createdAt: new Date(raw.createdAt).toISOString(), baseUrl: base.origin,
    connectionId: /^[a-f0-9]{64}$/.test(raw.connectionId) ? raw.connectionId : '',
    prompt: cleanText(raw.prompt), model: cleanText(raw.model, 200), ratio: cleanText(raw.ratio, 10),
    seconds: Number.isFinite(raw.seconds) ? raw.seconds : null,
    status: raw.status === 'submitting' ? 'unknown' : raw.status,
    progress: Number.isFinite(raw.progress) ? Math.max(0, Math.min(100, raw.progress)) : null,
    referenceCount: payload?.images?.length || 0,
    browserStored: true,
    ...(raw.remoteId && { remoteId: raw.remoteId }),
    ...(publicUrl(raw.url) && { url: raw.url }),
    error: raw.status === 'submitting' ? uncertainMessage : cleanText(raw.error),
  };
  return { job, payload };
}
export function parseBackup(value) {
  const rows = Array.isArray(value) ? value : value?.format === 'frame-indexeddb' && value.version === 1 ? value.jobs : null;
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('请选择帧序导出的备份文件（最多 10000 条任务）');
  return rows.map(cleanRecord);
}

export function createBrowserDB({ indexedDB = globalThis.indexedDB, name = 'frame-studio-v2' } = {}) {
  let opening;
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!indexedDB) return reject(new Error('此浏览器不支持 IndexedDB，请换用 Safari、Chrome 或 Edge 普通窗口'));
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const jobs = db.createObjectStore('jobs', { keyPath: 'id' });
        jobs.createIndex('requestToken', 'requestToken', { unique: true });
        jobs.createIndex('createdAt', 'createdAt');
        db.createObjectStore('payloads', { keyPath: 'id' });
      };
      req.onerror = () => { opening = null; reject(storageError(req.error)); };
      req.onblocked = () => { opening = null; reject(new Error('请关闭此网站的其他标签页后重试')); };
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
    });
    return opening;
  }
  async function transaction(stores, mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(storageError(tx.error));
      tx.onerror = () => {}; // onabort reports the transaction failure once.
      try { action(tx, value => { result = value; }); } catch (error) { tx.abort(); reject(error); }
    });
  }
  const api = {
    open,
    get: id => transaction(['jobs'], 'readonly', (tx, done) => { const r = tx.objectStore('jobs').get(id); r.onsuccess = () => done(r.result); }),
    payload: id => transaction(['payloads'], 'readonly', (tx, done) => { const r = tx.objectStore('payloads').get(id); r.onsuccess = () => done(r.result?.payload); }),
    list: () => transaction(['jobs'], 'readonly', (tx, done) => { const r = tx.objectStore('jobs').getAll(); r.onsuccess = () => done(r.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))); }),
    reserve: (job, payload) => transaction(['jobs', 'payloads'], 'readwrite', (tx, done) => {
      const jobs = tx.objectStore('jobs');
      const request = jobs.index('requestToken').get(job.requestToken);
      request.onsuccess = () => {
        if (request.result) return done({ created: false, job: request.result });
        jobs.add(job);
        if (payload) tx.objectStore('payloads').add({ id: job.id, payload });
        done({ created: true, job });
      };
    }),
    update: (id, changes) => transaction(['jobs'], 'readwrite', (tx, done) => {
      const jobs = tx.objectStore('jobs'), r = jobs.get(id);
      r.onsuccess = () => {
        if (!r.result) return done(null);
        const job = { ...r.result, ...changes, id };
        jobs.put(job); done(job);
      };
    }),
    async exportBackup() {
      return transaction(['jobs', 'payloads'], 'readonly', (tx, done) => {
        const rows = tx.objectStore('jobs').getAll(), inputs = tx.objectStore('payloads').getAll();
        let jobs, payloads;
        const finish = () => {
          if (!jobs || !payloads) return;
          const map = new Map(payloads.map(p => [p.id, p.payload]));
          done({ format: 'frame-indexeddb', version: 1, exportedAt: new Date().toISOString(), jobs: jobs.map(row => {
            const { job, payload } = cleanRecord({ ...row, payload: map.get(row.id) });
            return { ...job, ...(payload && { payload }) };
          }) });
        };
        rows.onsuccess = () => { jobs = rows.result; finish(); };
        inputs.onsuccess = () => { payloads = inputs.result; finish(); };
      });
    },
    async importBackup(value) {
      const records = parseBackup(value); // Validate everything before touching the database.
      return transaction(['jobs', 'payloads'], 'readwrite', (tx, done) => {
        let imported = 0, skipped = 0, i = 0;
        const jobs = tx.objectStore('jobs');
        const next = () => {
          if (i === records.length) return done({ imported, skipped });
          const { job, payload } = records[i++];
          const byId = jobs.get(job.id);
          byId.onsuccess = () => {
            if (byId.result) { skipped++; next(); return; }
            const byToken = jobs.index('requestToken').get(job.requestToken);
            byToken.onsuccess = () => {
              if (byToken.result) skipped++;
              else { jobs.add(job); if (payload) tx.objectStore('payloads').add({ id: job.id, payload }); imported++; }
              next();
            };
          };
        };
        next();
      });
    },
  };
  return api;
}

export function displayJob(job, now = Date.now()) {
  return job.status === 'submitting' && now - Date.parse(job.createdAt) > SUBMISSION_STALE_MS ? { ...job, status: 'unknown', error: uncertainMessage } : job;
}
