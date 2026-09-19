import express from 'express';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MODELS, buildPayload, normalizeTask, isDone, isSuccess } from '../shared/models.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.env.FRAME_DATA_DIR || resolve(root, '.local'));
mkdirSync(dataDir, { recursive: true });
function readJson(name, fallback) {
  const path = resolve(dataDir, name);
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}
function save(name, data) {
  const path = resolve(dataDir, name);
  writeFileSync(`${path}.tmp`, JSON.stringify(data), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
function fallbackKey() {
  if (process.env.DEEPKEY_API_KEY) return process.env.DEEPKEY_API_KEY.trim();
  try {
    const env = readFileSync(resolve(homedir(), '.config/deepkey/credentials.env'), 'utf8');
    const value = env.match(/^\s*DEEPKEY_API_KEY\s*=\s*(.+)\s*$/m)?.[1]?.trim() || '';
    return value.replace(/^['"]|['"]$/g, '').replace(/^Bearer\s+/i, '');
  } catch { return ''; }
}
let config = readJson('settings.json', { baseUrl: 'https://deepkey.top', apiKey: '', useLocalKey: true });
const jobs = readJson('jobs.json', []);
const key = () => config.apiKey || (config.useLocalKey ? fallbackKey() : '');
const fingerprint = () => createHash('sha256').update(key()).digest('hex').slice(0, 16);
const safeConfig = () => ({ baseUrl: config.baseUrl, hasKey: !!key(), keySource: config.apiKey ? '工作台配置' : config.useLocalKey && fallbackKey() ? '本机 DeepKey 凭据' : '未配置', models: MODELS });
const persistJobs = () => save('jobs.json', jobs);
for (const job of jobs) if (job.status === 'submitting') { job.status = 'unknown'; job.error = '上次提交被中断，可能已经受理。请先核对平台记录，再导入任务 ID。'; }
persistJobs();
const publicJob = ({ payload, keyFingerprint, ...job }) => ({ ...job, referenceCount: payload?.images?.length || 0 });
const app = express();
app.disable('x-powered-by');
// Restrict this single-user application to local, same-origin requests.
app.use((req, res, next) => {
  const host = req.headers.host?.split(':')[0];
  if (!['localhost', '127.0.0.1'].includes(host)) return res.status(403).json({ error: '仅允许本机访问' });
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.status(403).json({ error: '不允许跨站请求' });
  if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: '不允许跨站请求' });
  next();
});
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.json({ limit: '100mb' }));
app.get('/api/session', (_req, res) => res.json({ cloud: false, authenticated: true }));

async function upstream(path, options = {}, snapshot = { baseUrl: config.baseUrl, apiKey: key() }) {
  if (!snapshot.apiKey) throw new Error('请先在连接设置中配置 API Key');
  const response = await fetch(`${snapshot.baseUrl}/v1${path}`, {
    ...options, headers: { Authorization: `Bearer ${snapshot.apiKey}`, 'Content-Type': 'application/json', ...options.headers },
    redirect: 'error', signal: AbortSignal.timeout(options.method === 'POST' ? 180000 : 60000),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`平台返回非 JSON 响应 (HTTP ${response.status})`); }
  if (!response.ok || (data.error && !data.status)) {
    const error = new Error(data.error?.message || (typeof data.error === 'string' ? data.error : data.message) || `平台请求失败 (HTTP ${response.status})`);
    error.httpStatus = response.status;
    const seconds = Number(response.headers.get('retry-after'));
    error.retryMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 30000;
    throw error;
  }
  return data;
}
app.get('/api/settings', (_req, res) => res.json(safeConfig()));
app.put('/api/settings', (req, res) => {
  const baseUrl = String(req.body.baseUrl || '').trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('API 地址必须是有效 HTTPS 根地址');
  if (req.body.apiKey !== undefined && typeof req.body.apiKey !== 'string') throw new Error('API Key 格式错误');
  config = { ...config, baseUrl };
  if (req.body.apiKey?.trim()) config.apiKey = req.body.apiKey.trim().replace(/^Bearer\s+/i, '');
  if (req.body.clearKey) { config.apiKey = ''; config.useLocalKey = false; }
  if (req.body.useLocalKey) { config.apiKey = ''; config.useLocalKey = true; }
  save('settings.json', config);
  res.json(safeConfig());
});
app.post('/api/connection', async (_req, res) => {
  const data = await upstream('/models');
  const ids = (data.data || []).map(m => m.id);
  res.json({ models: ids.filter(id => MODELS.some(m => m.id === id)), total: ids.length });
});
app.get('/api/jobs', (_req, res) => res.json(jobs.map(publicJob)));
app.get('/api/jobs/:id/draft', (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: '找不到任务' });
  if (!job.payload) throw new Error('导入的任务没有保存生成参数');
  res.json(job.payload);
});
app.post('/api/jobs', async (req, res) => {
  const payload = buildPayload(req.body);
  if (!key()) throw new Error('请先配置 API Key');
  const requestToken = req.body.requestToken;
  if (typeof requestToken !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(requestToken)) throw new Error('请求标识无效，请刷新页面');
  const existing = jobs.find(j => j.requestToken === requestToken);
  if (existing) return res.json(publicJob(existing));
  const model = MODELS.find(m => m.id === payload.model);
  const snapshot = { baseUrl: config.baseUrl, apiKey: key() };
  const job = { id: randomUUID(), requestToken, createdAt: new Date().toISOString(), model: payload.model, prompt: payload.prompt, seconds: model.seconds || payload.seconds, ratio: payload.aspect_ratio, status: 'submitting', progress: 0, payload, baseUrl: config.baseUrl, keyFingerprint: fingerprint() };
  jobs.unshift(job);
  persistJobs();
  try {
    const data = normalizeTask(await upstream('/videos', { method: 'POST', body: JSON.stringify(payload) }, snapshot));
    if (!data.remoteId) throw new Error('平台响应缺少任务 ID');
    Object.assign(job, data);
  } catch (error) {
    const definiteRejection = [400, 401, 403, 404, 422, 429].includes(error.httpStatus);
    job.status = definiteRejection ? 'failed' : 'unknown';
    job.error = `${error.message}${definiteRejection ? '' : '；提交可能已受理，未自动重提。请核对平台记录后导入任务 ID。'}`;
  }
  persistJobs();
  res.json(publicJob(job));
});
app.post('/api/jobs/import', async (req, res) => {
  const remoteId = String(req.body.remoteId || '').trim();
  if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(remoteId)) throw new Error('任务 ID 格式无效');
  const existing = jobs.find(j => j.remoteId === remoteId && j.baseUrl === config.baseUrl);
  if (existing) return res.json(publicJob(existing));
  const snapshot = { baseUrl: config.baseUrl, apiKey: key() };
  const keyFingerprint = fingerprint();
  const data = await upstream(`/videos/${encodeURIComponent(remoteId)}`, {}, snapshot);
  const job = { id: randomUUID(), createdAt: new Date().toISOString(), prompt: '导入的任务', model: data.model || '', seconds: data.seconds || null, baseUrl: snapshot.baseUrl, keyFingerprint, ...normalizeTask(data), remoteId };
  jobs.unshift(job); persistJobs(); res.json(publicJob(job));
});
const refreshing = new Set();
async function refreshJob(job, force = false) {
  if (!job.remoteId || refreshing.has(job.id) || (!force && (isDone(job.status) || Date.now() < (job.nextPollAt || 0)))) return;
  if (job.keyFingerprint !== fingerprint() || job.baseUrl !== config.baseUrl) {
    job.pollError = '连接已切换，请恢复创建该任务时使用的地址和 Key 后继续查询';
    return;
  }
  refreshing.add(job.id);
  try {
    const data = normalizeTask(await upstream(`/videos/${encodeURIComponent(job.remoteId)}`));
    delete data.remoteId;
    Object.assign(job, data, { pollError: '', updatedAt: new Date().toISOString(), nextPollAt: Date.now() + 10000 });
  } catch (error) { job.pollError = error.message; job.nextPollAt = Date.now() + (error.retryMs || 30000); }
  finally { refreshing.delete(job.id); persistJobs(); }
}
app.post('/api/jobs/:id/refresh', async (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: '找不到任务' });
  await refreshJob(job, true); res.json(publicJob(job));
});
app.get('/api/jobs/:id/download', async (req, res) => {
  const job = jobs.find(j => j.id === req.params.id);
  if (!job || !isSuccess(job.status)) return res.status(404).json({ error: '视频尚未完成' });
  const url = job.url || `${job.baseUrl}/v1/videos/${encodeURIComponent(job.remoteId)}/content`;
  const response = await fetch(url, { signal: AbortSignal.timeout(900000) });
  const type = response.headers.get('content-type') || '';
  if (!response.ok || (!type.startsWith('video/') && !type.includes('octet-stream'))) throw new Error(`视频下载失败 (HTTP ${response.status})，请刷新任务后重试`);
  res.set('Content-Type', type);
  res.set('Content-Disposition', `attachment; filename="frame-${job.id}.mp4"`);
  try { await pipeline(Readable.fromWeb(response.body), res); } catch (error) { if (!res.destroyed) res.destroy(error); }
});
app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));

const server = createServer(app);
if (process.argv.includes('--production')) {
  if (!existsSync(resolve(root, 'dist/index.html'))) throw new Error('请先执行 npm run build');
  app.use(express.static(resolve(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(root, 'dist/index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: error.type === 'entity.too.large' ? '素材总大小超过 100 MB' : error.message || '请求失败' });
});
const timer = setInterval(async () => {
  for (const job of jobs) await refreshJob(job);
}, 10000);
timer.unref();
let port = Number(process.env.PORT || 3100);
server.on('error', error => { if (error.code === 'EADDRINUSE' && port < 3120) { port++; server.listen(port, '127.0.0.1'); } else { console.error(error.message); process.exit(1); } });
server.listen(port, '127.0.0.1', () => console.log(`FRAME Studio: http://127.0.0.1:${server.address().port}`));
