import { MODELS, buildPayload, isDone } from '../shared/models.mjs';
import { createBrowserDB, displayJob, uncertainMessage } from './browser-db.mjs';
import { prepareCloudPayload } from './reference-images.mjs';

export function createBrowserJobs({ db = createBrowserDB(), request, prepare = prepareCloudPayload, uuid = () => crypto.randomUUID(), changed = () => {} }) {
  let settings;
  const recovered = new Map();
  const running = new Set();
  const getSettings = async () => (settings = await request('/settings'));
  async function find(id) { const job = recovered.get(id) || await db.get(id); if (!job) throw new Error('找不到任务'); return job; }
  async function refresh(id, force = false) {
    const job = await find(id);
    if (!job.remoteId || running.has(id) || (!force && (isDone(job.status) || Date.now() < (job.nextPollAt || 0)))) return displayJob(job);
    const c = settings || await getSettings();
    if (job.connectionId !== c.connectionId || job.baseUrl !== c.baseUrl) return db.update(id, { pollError: '此记录属于其他连接，请恢复原来的 API 地址和 Key；旧版记录可按任务 ID 重新导入。', nextPollAt: Date.now() + 60000 });
    running.add(id);
    try {
      const data = await request('/videos/query', { method: 'POST', body: JSON.stringify({ remoteId: job.remoteId, connectionId: job.connectionId }) });
      const { remoteId: _remoteId, model: _model, seconds: _seconds, ...state } = data;
      const saved = await db.update(id, { ...recovered.get(id), ...state, pollError: '', nextPollAt: Date.now() + 15000, updatedAt: new Date().toISOString() });
      recovered.delete(id);
      return saved;
    } catch (error) {
      return await db.update(id, { pollError: error.message, nextPollAt: Date.now() + (error.retryMs || 30000) });
    } finally { running.delete(id); changed(); }
  }
  return {
    db, getSettings,
    async backup() {
      const backup = await db.exportBackup();
      backup.jobs = backup.jobs.map(job => ({ ...job, ...recovered.get(job.id) }));
      return backup;
    },
    async route(path, options = {}) {
      const url = new URL(path, 'https://frame.invalid');
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : {};
      if (url.pathname === '/jobs' && method === 'GET') return (await db.list()).map(job => displayJob(recovered.get(job.id) || job));
      if (path === '/jobs' && method === 'POST') {
        if (typeof body.requestToken !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestToken)) throw new Error('请求标识无效，请刷新页面');
        const payload = buildPayload(body);
        if (payload.prompt.length > 8000) throw new Error('提示词最多 8000 个字符');
        const c = await getSettings();
        if (!c.hasKey) throw new Error('请在连接设置中填写自己的 API Key');
        const prepared = await prepare(payload);
        const model = MODELS.find(m => m.id === payload.model);
        const job = { id: uuid(), requestToken: body.requestToken, createdAt: new Date().toISOString(), model: payload.model, prompt: payload.prompt, seconds: model.seconds || payload.seconds, ratio: payload.aspect_ratio, status: 'submitting', progress: 0, referenceCount: payload.images?.length || 0, baseUrl: c.baseUrl, connectionId: c.connectionId, browserStored: true };
        // Claim and payload commit atomically BEFORE any paid request is sent.
        const result = await db.reserve(job, payload);
        if (!result.created) return displayJob(result.job);
        changed();
        let data;
        try {
          data = await request('/videos', { method: 'POST', body: JSON.stringify({ ...prepared, connectionId: c.connectionId }), signal: AbortSignal.timeout(210000) });
        } catch (error) {
          const rejected = [400, 401, 403, 409, 413, 422, 429].includes(error.status);
          data = { status: rejected ? 'failed' : 'unknown', error: rejected ? error.message : `${error.message}；${uncertainMessage}` };
        }
        try {
          const saved = await db.update(job.id, data);
          if (!saved) throw new Error('任务记录丢失');
          changed(); return saved;
        } catch {
          // Preserve a received remote ID in the UI even if storage fails after acceptance.
          const error = new Error(`任务结果未能写入浏览器，切勿重新提交。${data.remoteId ? `请立即复制并保存任务 ID：${data.remoteId}` : uncertainMessage}`);
          error.recoveryJob = { ...job, ...data, pollError: error.message };
          recovered.set(job.id, error.recoveryJob);
          throw error;
        }
      }
      if (path === '/jobs/sync') {
        await getSettings();
        const pending = (await db.list()).map(j => recovered.get(j.id) || j).filter(j => j.remoteId && !isDone(j.status) && Date.now() >= (j.nextPollAt || 0)).sort((a, b) => (a.nextPollAt || 0) - (b.nextPollAt || 0)).slice(0, 5);
        await Promise.all(pending.map(j => refresh(j.id))); return { ok: true };
      }
      if (path === '/jobs/import') {
        const remoteId = String(body.remoteId || '').trim();
        if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(remoteId)) throw new Error('任务 ID 格式无效');
        const c = await getSettings();
        const data = await request('/videos/query', { method: 'POST', body: JSON.stringify({ remoteId, connectionId: c.connectionId }) });
        const existing = (await db.list()).find(j => j.remoteId === remoteId && j.connectionId === c.connectionId);
        if (existing) { const { model, seconds, ...state } = data; return db.update(existing.id, state); }
        const legacy = (await db.list()).find(j => j.remoteId === remoteId && j.baseUrl === c.baseUrl && !j.connectionId);
        if (legacy) {
          const { model, seconds, ...state } = data;
          return db.update(legacy.id, { ...state, connectionId: c.connectionId, browserStored: true, pollError: '' });
        }
        const job = { id: uuid(), requestToken: `import-${uuid()}`, createdAt: new Date().toISOString(), prompt: '导入的任务', baseUrl: c.baseUrl, connectionId: c.connectionId, browserStored: true, ...data };
        return (await db.reserve(job)).job;
      }
      const match = path.match(/^\/jobs\/([a-zA-Z0-9-]+)\/(draft|refresh)$/);
      if (match?.[2] === 'refresh') { await getSettings(); return refresh(match[1], true); }
      if (match?.[2] === 'draft') {
        const payload = await db.payload(match[1]);
        if (!payload) throw new Error('导入的任务没有保存生成参数');
        return payload;
      }
      throw new Error('浏览器任务操作不存在');
    },
  };
}
