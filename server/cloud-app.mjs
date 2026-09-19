import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { get as getBlob } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import { waitUntil } from '@vercel/functions';
import { MODELS, buildPayload, normalizeTask, isDone, isSuccess } from '../shared/models.mjs';
import { security, equalSecret, referencePath, referencePattern } from './cloud-security.mjs';
import { cloudStore } from './cloud-store.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const publicJob = ({ keyFingerprint, ...job }) => job;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const cookieName = 'frame_session';
const cookie = (value, maxAge) => `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// Dependency injection lets integration tests simulate cold starts and concurrent instances.
export function createCloudApp({ env = process.env, store: suppliedStore, defer = waitUntil, fetcher = fetch, blobGet = getBlob, uploadHandler = handleUpload } = {}) {
  const app = express();
  app.disable('x-powered-by');
  let store, auth;
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    try {
      auth ||= security(env);
      store ||= suppliedStore || cloudStore(env);
      const host = req.headers.host;
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `https://${host}` && !(env.FRAME_CLOUD_DEV === '1' && req.headers.origin === `http://${host}`))) throw fail('不允许跨站请求', 403);
      next();
    } catch (error) { next(fail(error.message, error.status || 503)); }
  });
  app.use(express.json({ limit: '512kb' }));
  const authenticated = req => {
    const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return token && auth.verify(token);
  };
  app.get('/api/session', (req, res) => res.json({ cloud: true, authenticated: !!authenticated(req) }));
  app.post('/api/login', async (req, res) => {
    // The global limit also covers callers supplying forged forwarded headers.
    if (!await store.limit('login', 30, 300)) throw fail('登录尝试过多，请五分钟后再试', 429);
    if (typeof req.body.password !== 'string' || !equalSecret(req.body.password, env.FRAME_PASSWORD)) throw fail('工作台密码不正确', 401);
    res.set('Set-Cookie', cookie(auth.issue(), 7 * 86400)).json({ ok: true });
  });
  app.post('/api/logout', (_req, res) => res.set('Set-Cookie', cookie('', 0)).json({ ok: true }));
  app.use('/api', (req, _res, next) => next(authenticated(req) ? undefined : fail('请先登录工作台', 401)));

  const baseUrl = () => {
    const url = new URL(env.DEEPKEY_BASE_URL || 'https://deepkey.top');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw fail('DEEPKEY_BASE_URL 必须为 HTTPS 根地址', 503);
    return url.origin;
  };
  async function config() {
    const saved = await store.getConfig() || {};
    const apiKey = saved.encryptedKey ? auth.decrypt(saved.encryptedKey) : saved.disabled ? '' : (env.DEEPKEY_API_KEY || '').trim().replace(/^Bearer\s+/i, '');
    return { baseUrl: baseUrl(), apiKey, keyFingerprint: hash(apiKey).slice(0, 16), keySource: saved.encryptedKey ? '云端加密配置' : apiKey ? 'Vercel 环境变量' : '未配置' };
  }
  const safeConfig = c => ({ cloud: true, baseUrl: c.baseUrl, hasKey: !!c.apiKey, keySource: c.keySource, models: MODELS });
  async function upstream(path, c, options = {}) {
    if (!c.apiKey) throw fail('请先在连接设置中配置 API Key');
    const response = await fetcher(`${c.baseUrl}/v1${path}`, { ...options, headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(options.method === 'POST' ? 180000 : 20000) });
    let data;
    try { data = await response.json(); } catch { throw fail(`平台返回非 JSON 响应 (HTTP ${response.status})`); }
    if (!response.ok || (data.error && !data.status)) {
      const error = fail(data.error?.message || (typeof data.error === 'string' ? data.error : data.message) || `平台请求失败 (HTTP ${response.status})`);
      error.httpStatus = response.status;
      error.retryMs = Math.min(3600000, Math.max(30000, Number(response.headers.get('retry-after') || 0) * 1000));
      throw error;
    }
    return data;
  }
  app.get('/api/settings', async (_req, res) => res.json(safeConfig(await config())));
  app.put('/api/settings', async (req, res) => {
    if (req.body.baseUrl && req.body.baseUrl.replace(/\/+$/, '') !== baseUrl()) throw fail('云端 API 地址请在 Vercel 的 DEEPKEY_BASE_URL 环境变量中修改');
    if (req.body.apiKey !== undefined && typeof req.body.apiKey !== 'string') throw fail('API Key 格式错误');
    const value = req.body.apiKey?.trim().replace(/^Bearer\s+/i, '');
    if (value) await store.setConfig({ encryptedKey: auth.encrypt(value) });
    if (req.body.clearKey) await store.setConfig({ disabled: true });
    if (req.body.useLocalKey) await store.setConfig({});
    res.json(safeConfig(await config()));
  });
  app.post('/api/connection', async (_req, res) => {
    const data = await upstream('/models', await config());
    const ids = (data.data || []).map(m => m.id);
    res.json({ models: ids.filter(id => MODELS.some(m => m.id === id)), total: ids.length });
  });
  app.post('/api/upload', async (req, res) => {
    if (!env.BLOB_READ_WRITE_TOKEN) throw fail('请先连接 Private Vercel Blob 存储', 503);
    if (!await store.limit('uploads', 100, 3600)) throw fail('本小时上传次数已达上限，请稍后再试', 429);
    const data = await uploadHandler({ body: req.body, request: req, token: env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async pathname => {
        if (!referencePattern.test(pathname)) throw fail('图片路径无效');
        return { allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp'], maximumSizeInBytes: 10 * 1024 * 1024, addRandomSuffix: false, allowOverwrite: false, validUntil: Date.now() + 10 * 60000 };
      },
    });
    res.json(data);
  });
  async function reference(path) {
    if (!referencePattern.test(path)) throw fail('图片路径无效');
    const blob = await blobGet(path, { access: 'private', token: env.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(30000) });
    if (!blob || blob.statusCode !== 200) throw fail('参考图不存在，请重新上传', 404);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.blob.contentType) || blob.blob.size > 10 * 1024 * 1024) throw fail('参考图片类型或大小无效');
    return blob;
  }
  app.get('/api/references', async (req, res) => {
    const blob = await reference(String(req.query.path || ''));
    res.set('Content-Type', blob.blob.contentType);
    await pipeline(Readable.fromWeb(blob.stream), res);
  });
  async function materialize(payload) {
    const images = await Promise.all((payload.images || []).map(async value => {
      const path = referencePath(value);
      if (!path) return value;
      const blob = await reference(path);
      const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
      if (bytes.length > 10 * 1024 * 1024) throw fail('单张参考图超过 10 MB');
      return `data:${blob.blob.contentType};base64,${bytes.toString('base64')}`;
    }));
    return { ...payload, ...(images.length ? { images } : {}) };
  }
  async function submitJob(job, payload, c) {
    let sent = false;
    try {
      const body = JSON.stringify(await materialize(payload));
      sent = true;
      const data = normalizeTask(await upstream('/videos', c, { method: 'POST', body }));
      if (!data.remoteId) throw fail('平台响应缺少任务 ID');
      Object.assign(job, data);
    } catch (error) {
      const rejected = !sent || [400, 401, 403, 404, 422, 429].includes(error.httpStatus);
      job.status = rejected ? 'failed' : 'unknown';
      job.error = `${error.message}${rejected ? '' : '；提交可能已受理，未自动重提。请核对平台记录后导入任务 ID。'}`;
    }
    // Retrying this storage write is safe; repeating the upstream POST is not.
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await store.saveJob(job); return; } catch { /* A stale receipt becomes unknown on the next read. */ }
    }
  }
  app.post('/api/jobs', async (req, res) => {
    const payload = buildPayload(req.body);
    if (payload.prompt.length > 8000) throw fail('提示词最多 8000 个字符');
    if (payload.images?.some(v => v.startsWith('data:'))) throw fail('云端参考图请先上传到素材存储');
    for (const value of payload.images || []) referencePath(value);
    const requestToken = req.body.requestToken;
    if (typeof requestToken !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestToken)) throw fail('请求标识无效，请刷新页面');
    const c = await config();
    if (!c.apiKey) throw fail('请先配置 API Key');
    const model = MODELS.find(m => m.id === payload.model);
    const job = { id: randomUUID(), requestToken, createdAt: new Date().toISOString(), model: payload.model, prompt: payload.prompt, seconds: model.seconds || payload.seconds, ratio: payload.aspect_ratio, status: 'submitting', progress: 0, referenceCount: payload.images?.length || 0, baseUrl: c.baseUrl, keyFingerprint: c.keyFingerprint };
    const result = await store.create(job, payload, requestToken);
    if (result.created) defer(submitJob(job, payload, c));
    res.status(202).json(publicJob(result.job));
  });
  async function refresh(job, c, force = false) {
    // Submission is never retried, including after cold starts or function termination.
    if (job.status === 'submitting' && Date.now() - Date.parse(job.createdAt) > 300000) {
      await store.retire(job.id);
      job = { ...job, status: 'unknown', error: '提交结果未能确认，未自动重提。请先核对平台记录，再导入任务 ID。' };
      // Display only: a late successful writer must be able to save the remote ID.
      return job;
    }
    if (isDone(job.status)) { await store.retire(job.id); if (!force) return job; }
    if (!job.remoteId) { await store.postpone(job.id, Date.now() + 30000); return job; }
    if (!force && Date.now() < (job.nextPollAt || 0)) return job;
    if (job.keyFingerprint !== c.keyFingerprint || job.baseUrl !== c.baseUrl) {
      await store.postpone(job.id, Date.now() + 60000);
      return { ...job, pollError: '连接已切换，请恢复创建该任务时使用的地址和 Key 后继续查询' };
    }
    const owner = randomUUID();
    if (!await store.lock(job.id, owner, 60)) return job;
    try {
      job = await store.getJob(job.id);
      if (!force && Date.now() < (job.nextPollAt || 0)) return job;
      try {
        const data = normalizeTask(await upstream(`/videos/${encodeURIComponent(job.remoteId)}`, c));
        delete data.remoteId;
        Object.assign(job, data, { pollError: '', updatedAt: new Date().toISOString(), nextPollAt: Date.now() + 15000 });
      } catch (error) { job.pollError = error.message; job.nextPollAt = Date.now() + (error.retryMs || 30000); }
      await store.saveJob(job);
      return job;
    } finally { await store.unlock(job.id, owner); }
  }
  async function findJob(id) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw fail('任务 ID 无效');
    const job = await store.getJob(id);
    if (!job) throw fail('找不到任务', 404);
    return job;
  }
  app.get('/api/jobs', async (req, res) => {
    const offset = req.query.offset;
    if (offset && !/^\d{1,7}$/.test(offset)) throw fail('分页参数无效');
    res.json((await store.list(offset)).map(job => publicJob(job.status === 'submitting' && Date.now() - Date.parse(job.createdAt) > 300000 ? { ...job, status: 'unknown', error: '提交结果未能确认，未自动重提。请核对平台记录后导入任务 ID。' } : job)));
  });
  app.post('/api/jobs/sync', async (_req, res) => {
    const [jobs, c] = await Promise.all([store.active(), config()]);
    await Promise.all(jobs.map(job => refresh(job, c)));
    res.json({ ok: true });
  });
  app.get('/api/jobs/:id/draft', async (req, res) => {
    await findJob(req.params.id);
    const payload = await store.getPayload(req.params.id);
    if (!payload) throw fail('导入的任务没有保存生成参数');
    res.json(payload);
  });
  app.post('/api/jobs/:id/refresh', async (req, res) => res.json(publicJob(await refresh(await findJob(req.params.id), await config(), true))));
  app.post('/api/jobs/import', async (req, res) => {
    const remoteId = String(req.body.remoteId || '').trim();
    if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(remoteId)) throw fail('任务 ID 格式无效');
    const c = await config();
    const data = await upstream(`/videos/${encodeURIComponent(remoteId)}`, c);
    const job = { id: randomUUID(), createdAt: new Date().toISOString(), prompt: '导入的任务', model: data.model || '', seconds: data.seconds || null, baseUrl: c.baseUrl, keyFingerprint: c.keyFingerprint, ...normalizeTask(data), remoteId };
    res.json(publicJob((await store.create(job, null, `import:${hash(`${c.baseUrl}:${c.keyFingerprint}:${remoteId}`)}`)).job));
  });
  app.get('/api/jobs/:id/download', async (req, res) => {
    const job = await findJob(req.params.id);
    if (!isSuccess(job.status)) throw fail('视频尚未完成', 404);
    // Videos can exceed Vercel's response limit; download directly from the provider.
    res.redirect(302, job.url || `${job.baseUrl}/v1/videos/${encodeURIComponent(job.remoteId)}/content`);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) { res.destroy(); return; }
    res.status(error.type === 'entity.too.large' ? 413 : error.status || 400).json({ error: error.type === 'entity.too.large' ? '请求过大，请通过素材上传功能添加图片' : error.message || '请求失败' });
  });
  return app;
}
