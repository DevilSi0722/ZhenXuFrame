import express from 'express';
import { security, equalSecret } from './cloud-security.mjs';
import { buildPayload } from '../shared/models.mjs';
import { MAX_REQUEST_BYTES } from '../shared/limits.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const cookieName = 'frame_session';
const cookie = (value, age) => `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;

// Provider keys are request-scoped only: never read shared environment credentials.
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
  const authenticated = req => {
    const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    return token && auth.verify(token);
  };
  app.get('/api/session', (req, res) => res.json({ cloud: true, storage: 'indexeddb', authenticated: !!authenticated(req) }));
  let attempts = 0, resetAt = 0;
  app.post('/api/login', express.json({ limit: 4096 }), (req, res) => {
    if (Date.now() > resetAt) { attempts = 0; resetAt = Date.now() + 300000; }
    if (++attempts > 30) throw fail('登录尝试过多，请稍后再试', 429);
    if (typeof req.body?.password !== 'string' || !equalSecret(req.body.password, env.FRAME_PASSWORD)) throw fail('工作台密码不正确', 401);
    res.set('Set-Cookie', cookie(auth.issue(), 7 * 86400)).json({ ok: true });
  });
  app.post('/api/logout', (_req, res) => res.set('Set-Cookie', cookie('', 0)).json({ ok: true }));
  app.use('/api/provider', (req, _res, next) => next(authenticated(req) ? undefined : fail('工作台登录已过期，请刷新后重新登录', 401)));
  async function relay(req, res, path, payload) {
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer [^\s]{1,4096}$/.test(authorization)) throw fail('请配置自己的 API Key', 400);
    let response;
    try {
      response = await fetcher(`https://deepkey.top/v1${path}`, { method: payload ? 'POST' : 'GET', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, ...(payload && { body: JSON.stringify(payload) }), redirect: 'error', signal: AbortSignal.timeout(payload ? 180000 : 20000) });
    } catch { throw fail('平台连接中断，提交结果可能待确认，请勿重复提交', 502); }
    let data;
    try { data = await response.json(); } catch { throw fail('平台响应无法解析，请核对任务状态', 502); }
    if (!response.ok) return res.status(response.status).json({ error: `DeepKey 请求失败 (${response.status})` });
    if (data.error && !data.status) return res.status(502).json({ error: '平台未返回可确认的任务结果' });
    res.json(data);
  }
  app.get('/api/provider/models', (req, res) => relay(req, res, '/models'));
  app.post('/api/provider/videos', express.json({ limit: MAX_REQUEST_BYTES }), (req, res) => {
    const payload = buildPayload(req.body);
    if (payload.prompt.length > 8000) throw fail('提示词最多 8000 个字符');
    return relay(req, res, '/videos', payload);
  });
  app.get('/api/provider/videos/:id', (req, res) => {
    if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(req.params.id)) throw fail('任务 ID 格式无效');
    return relay(req, res, `/videos/${encodeURIComponent(req.params.id)}`);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '此接口已停用，请刷新页面并在连接设置中配置个人 Key' }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) { res.destroy(); return; }
    res.status(error.status || 400).json({ error: error.type === 'entity.too.large' ? '请求过大' : error.message || '请求失败' });
  });
  return app;
}
