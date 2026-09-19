import express from 'express';
import { createHash } from 'node:crypto';
import { MODELS, buildPayload, normalizeTask } from '../shared/models.mjs';
import { security, equalSecret } from './cloud-security.mjs';
import { MAX_REQUEST_BYTES } from '../shared/limits.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const cookieName = 'frame_session';
const cookie = (value, age) => `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;

// Stateless API: task records and references live in the browser's IndexedDB.
export function createCloudApp({ env = process.env, fetcher = fetch } = {}) {
  const app = express();
  app.disable('x-powered-by');
  let auth;
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    try {
      auth ||= security(env);
      const origin = `${env.FRAME_CLOUD_DEV === '1' ? 'http' : 'https'}://${req.headers.host}`;
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)) throw fail('不允许跨站请求', 403);
      next();
    } catch (error) { next(fail(error.message, error.status || 503)); }
  });
  app.use(express.json({ limit: MAX_REQUEST_BYTES }));
  const authenticated = req => {
    const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return token && auth.verify(token);
  };
  app.get('/api/session', (req, res) => res.json({ cloud: true, storage: 'indexeddb', authenticated: !!authenticated(req) }));
  // Per-instance best effort throttling; no external database is needed.
  let attempts = 0, resetAt = 0;
  app.post('/api/login', (req, res) => {
    if (Date.now() > resetAt) { attempts = 0; resetAt = Date.now() + 300000; }
    if (++attempts > 30) throw fail('登录尝试过多，请稍后再试', 429);
    if (typeof req.body.password !== 'string' || !equalSecret(req.body.password, env.FRAME_PASSWORD)) throw fail('工作台密码不正确', 401);
    res.set('Set-Cookie', cookie(auth.issue(), 7 * 86400)).json({ ok: true });
  });
  app.post('/api/logout', (_req, res) => res.set('Set-Cookie', cookie('', 0)).json({ ok: true }));
  app.use('/api', (req, _res, next) => next(authenticated(req) ? undefined : fail('请先登录工作台', 401)));
  function config() {
    const url = new URL(env.DEEPKEY_BASE_URL || 'https://deepkey.top');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw fail('DEEPKEY_BASE_URL 必须为 HTTPS 根地址', 503);
    const apiKey = (env.DEEPKEY_API_KEY || '').trim().replace(/^Bearer\s+/i, '');
    return { baseUrl: url.origin, apiKey, connectionId: createHash('sha256').update(`${url.origin}\n${apiKey}`).digest('hex') };
  }
  app.get('/api/settings', (_req, res) => {
    const c = config();
    res.json({ cloud: true, storage: 'indexeddb', baseUrl: c.baseUrl, connectionId: c.connectionId, hasKey: !!c.apiKey, keySource: c.apiKey ? 'Vercel 环境变量' : '未配置 DEEPKEY_API_KEY', models: MODELS });
  });
  app.put('/api/settings', () => { throw fail('请在 Vercel 环境变量中设置 DEEPKEY_API_KEY，然后重新部署'); });
  async function upstream(path, c, options = {}) {
    if (!c.apiKey) throw fail('请在 Vercel 配置 DEEPKEY_API_KEY 并重新部署');
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
  app.post('/api/connection', async (_req, res) => {
    const data = await upstream('/models', config());
    const ids = (data.data || []).map(m => m.id);
    res.json({ models: ids.filter(id => MODELS.some(m => m.id === id)), total: ids.length });
  });
  const checkConnection = (body, c) => {
    if (body.connectionId !== c.connectionId) throw fail('连接已更改，请恢复创建任务时的 API 地址和 Key 后查询；新任务请刷新页面后提交', 409);
  };
  app.post('/api/videos', async (req, res) => {
    const payload = buildPayload(req.body);
    if (payload.prompt.length > 8000) throw fail('提示词最多 8000 个字符');
    if (payload.images?.some(v => v.startsWith('https://frame-reference.invalid/'))) throw fail('旧版云端参考图请重新添加');
    const c = config(); checkConnection(req.body, c);
    if (!c.apiKey) throw fail('请配置 DEEPKEY_API_KEY');
    try {
      const data = normalizeTask(await upstream('/videos', c, { method: 'POST', body: JSON.stringify(payload) }));
      if (!data.remoteId || typeof data.remoteId !== 'string') throw fail('平台响应缺少任务 ID');
      res.json(data);
    } catch (error) {
      const rejected = [400, 401, 403, 404, 422, 429].includes(error.httpStatus);
      res.json({ status: rejected ? 'failed' : 'unknown', error: `${error.message}${rejected ? '' : '；提交可能已受理，未自动重提。请核对平台记录后导入任务 ID。'}` });
    }
  });
  app.post('/api/videos/query', async (req, res) => {
    const remoteId = req.body.remoteId;
    if (typeof remoteId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(remoteId)) throw fail('任务 ID 格式无效');
    const c = config(); checkConnection(req.body, c);
    const raw = await upstream(`/videos/${encodeURIComponent(remoteId)}`, c);
    res.json({ ...normalizeTask(raw), remoteId, model: typeof raw.model === 'string' ? raw.model : '', seconds: Number.isFinite(raw.seconds) ? raw.seconds : null });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) { res.destroy(); return; }
    res.status(error.type === 'entity.too.large' ? 413 : error.status || 400).json({ error: error.type === 'entity.too.large' ? '参考图总大小超过提交限制，请减少图片或使用图片直链' : error.message || '请求失败', ...(error.retryMs && { retryMs: error.retryMs }) });
  });
  return app;
}
