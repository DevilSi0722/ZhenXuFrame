import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCloudApp } from '../server/cloud-app.mjs';
import { security, referencePath } from '../server/cloud-security.mjs';
import { MODELS } from '../shared/models.mjs';

export const testEnv = { FRAME_PASSWORD: 'test-password-for-studio', FRAME_SECRET: 'test-encryption-secret-with-32-characters', DEEPKEY_API_KEY: 'test-provider-key', FRAME_CLOUD_DEV: '1', BLOB_READ_WRITE_TOKEN: 'test-blob-token' };
export function memoryStore() {
  let settings;
  const jobs = new Map(), payloads = new Map(), receipts = new Map(), locks = new Map(), limits = new Map(), activeIds = new Set();
  return {
    jobs, payloads, limits,
    getConfig: async () => structuredClone(settings), setConfig: async value => { settings = structuredClone(value); },
    getJob: async id => structuredClone(jobs.get(id)),
    saveJob: async job => { jobs.set(job.id, structuredClone(job)); if (['completed', 'succeeded', 'failed', 'unknown'].includes(job.status)) activeIds.delete(job.id); else activeIds.add(job.id); },
    getPayload: async id => structuredClone(payloads.get(id)),
    async create(job, payload, receipt) {
      if (receipts.has(receipt)) return { created: false, job: await this.getJob(receipts.get(receipt)) };
      receipts.set(receipt, job.id); jobs.set(job.id, structuredClone(job)); payloads.set(job.id, structuredClone(payload)); activeIds.add(job.id);
      return { created: true, job: structuredClone(job) };
    },
    list: async (offset = 0) => structuredClone([...jobs.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(Number(offset), Number(offset) + 100)),
    active: async () => structuredClone([...activeIds].map(id => jobs.get(id)).filter(j => !j.nextPollAt || j.nextPollAt <= Date.now()).slice(0, 5)),
    retire: async id => activeIds.delete(id),
    postpone: async () => {},
    lock: async (key, owner) => { if (locks.has(key)) return null; locks.set(key, owner); return 'OK'; },
    unlock: async (key, owner) => { if (locks.get(key) === owner) locks.delete(key); },
    limit: async (name, max) => { const count = (limits.get(name) || 0) + 1; limits.set(name, count); return count <= max; },
  };
}
async function serve(t, options = {}) {
  const pending = [];
  const store = options.store || memoryStore();
  const app = createCloudApp({ env: testEnv, store, defer: task => pending.push(task), ...options });
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const token = security(testEnv).issue();
  async function request(path, { body, method = body === undefined ? 'GET' : 'POST', anonymous = false, headers = {}, ...rest } = {}) {
    return fetch(origin + '/api' + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(!anonymous && { Cookie: `frame_session=${token}` }), ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }), ...rest });
  }
  return { store, pending, request };
}
const input = (extra = {}) => ({ model: MODELS[0].id, prompt: 'Test scene', aspect_ratio: '16:9', requestToken: 'request-token-12345678', ...extra });
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('sessions expire, reject tampering/password rotation; keys are encrypted', () => {
  const auth = security(testEnv), token = auth.issue(1000);
  assert.equal(auth.verify(token, 2000), true);
  assert.equal(auth.verify(token, 8 * 86400000), false);
  assert.equal(auth.verify(token + 'x', 2000), false);
  assert.equal(security({ ...testEnv, FRAME_PASSWORD: 'a-new-test-password' }).verify(token, 2000), false);
  const encrypted = auth.encrypt('private-key');
  assert.ok(!encrypted.includes('private-key'));
  assert.equal(auth.decrypt(encrypted), 'private-key');
  assert.throws(() => referencePath('https://frame-reference.invalid/../../settings'));
});

test('all private endpoints require authentication; login is limited; cross-origin blocked', async t => {
  const { request } = await serve(t);
  for (const [path, method] of [['/settings', 'GET'], ['/jobs', 'GET'], ['/jobs', 'POST'], ['/upload', 'POST'], ['/references?path=x', 'GET'], ['/jobs/a/download', 'GET']]) {
    assert.equal((await request(path, { method, anonymous: true })).status, 401);
  }
  assert.equal((await request('/settings', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const login = await request('/login', { body: { password: testEnv.FRAME_PASSWORD }, anonymous: true });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  for (let i = 0; i < 29; i++) assert.equal((await request('/login', { body: { password: 'wrong' }, anonymous: true })).status, 401);
  assert.equal((await request('/login', { body: { password: 'wrong' }, anonymous: true })).status, 429);
});

test('cloud settings persist encrypted, redact keys and restrict API origin', async t => {
  const store = memoryStore();
  const { request } = await serve(t, { store });
  const saved = await request('/settings', { method: 'PUT', body: { apiKey: 'a-new-provider-key' } });
  assert.equal(saved.status, 200);
  assert.ok(!(await saved.text()).includes('a-new-provider-key'));
  assert.ok(!JSON.stringify(await store.getConfig()).includes('a-new-provider-key'));
  assert.equal((await request('/settings', { method: 'PUT', body: { baseUrl: 'https://evil.example' } })).status, 400);
  const cold = await serve(t, { store });
  assert.equal((await (await cold.request('/settings')).json()).hasKey, true);
});

test('concurrent instances submit once, preserve private references, survive cold starts and sync status', async t => {
  const store = memoryStore(); let calls = 0, sent;
  let release; const gate = new Promise(resolve => { release = resolve; });
  const options = { store, fetcher: async (_url, init) => {
    if (init.method === 'POST') { calls++; sent = JSON.parse(init.body); await gate; return json({ task_id: 'remote-1', status: 'queued' }); }
    return json({ id: 'remote-1', status: 'completed', metadata: { url: 'https://media.example/video.mp4' } });
  }, blobGet: async () => ({ statusCode: 200, stream: new Response('image-bytes').body, blob: { contentType: 'image/png', size: 11 } }) };
  const a = await serve(t, options), b = await serve(t, options);
  const ref = 'https://frame-reference.invalid/references/12345678-1234-1234-1234-123456789abc.png';
  const [ra, rb] = await Promise.all([a.request('/jobs', { body: input({ images: [ref] }) }), b.request('/jobs', { body: input({ images: [ref] }) })]);
  assert.equal(ra.status, 202); assert.equal(rb.status, 202);
  const [ja, jb] = await Promise.all([ra.json(), rb.json()]);
  assert.equal(ja.id, jb.id); assert.equal(ja.status, 'submitting');
  release(); await Promise.all([...a.pending, ...b.pending]);
  assert.equal(calls, 1);
  assert.equal(sent.images[0], 'data:image/png;base64,aW1hZ2UtYnl0ZXM=');
  const cold = await serve(t, options);
  const list = await (await cold.request('/jobs')).json();
  assert.equal(list[0].remoteId, 'remote-1'); assert.equal(list[0].payload, undefined); assert.equal(list[0].keyFingerprint, undefined);
  assert.deepEqual((await (await cold.request(`/jobs/${ja.id}/draft`)).json()).images, [ref]);
  await cold.request('/jobs/sync', { body: {} });
  assert.equal((await store.getJob(ja.id)).status, 'completed');
  const download = await cold.request(`/jobs/${ja.id}/download`);
  assert.equal(download.status, 302); assert.equal(download.headers.get('location'), 'https://media.example/video.mp4');
  await cold.request('/jobs', { body: input() }); assert.equal(calls, 1);
});

test('uncertain submissions and interrupted execution never auto-retry; failed query responses normalize', async t => {
  let calls = 0;
  const { request, pending, store } = await serve(t, { fetcher: async () => { calls++; throw new Error('network interrupted'); } });
  const job = await (await request('/jobs', { body: input() })).json(); await Promise.all(pending);
  assert.equal((await store.getJob(job.id)).status, 'unknown');
  await request('/jobs', { body: input() }); await request('/jobs/sync', { body: {} }); assert.equal(calls, 1);
  const stale = { ...job, createdAt: new Date(Date.now() - 360000).toISOString(), status: 'submitting' };
  await store.saveJob(stale);
  assert.equal((await (await request('/jobs')).json())[0].status, 'unknown');
  await request('/jobs/sync', { body: {} }); assert.equal(calls, 1);
  // A late successful submission write is not clobbered by stale detection.
  await store.saveJob({ ...stale, remoteId: 'remote-failed', status: 'queued', keyFingerprint: (await import('node:crypto')).createHash('sha256').update(testEnv.DEEPKEY_API_KEY).digest('hex').slice(0, 16) });
  const cold = await serve(t, { store, fetcher: async () => json({ status: 'failed', error: { message: 'provider rejection' } }) });
  const refreshed = await (await cold.request(`/jobs/${job.id}/refresh`, { body: {} })).json();
  assert.equal(refreshed.status, 'failed'); assert.equal(refreshed.error, 'provider rejection');
});

test('upload tokens enforce private reference paths, image types and size; cloud refuses inline images', async t => {
  let rules;
  const { request, pending } = await serve(t, { uploadHandler: async options => {
    rules = await options.onBeforeGenerateToken(options.body.pathname);
    return { ok: true };
  } });
  assert.equal((await request('/upload', { body: { pathname: 'settings.json' } })).status, 400);
  assert.equal((await request('/upload', { body: { pathname: 'references/12345678-1234-1234-1234-123456789abc.png' } })).status, 200);
  assert.equal(rules.maximumSizeInBytes, 10 * 1024 * 1024); assert.equal(rules.allowOverwrite, false);
  assert.deepEqual(rules.allowedContentTypes, ['image/png', 'image/jpeg', 'image/webp']);
  assert.equal((await request('/jobs', { body: input({ images: ['data:image/png;base64,YQ=='] }) })).status, 400);
  assert.equal(pending.length, 0);
});

test('history paginates and deployment fails closed without access secrets', async t => {
  const { request, store } = await serve(t);
  for (let i = 0; i < 110; i++) store.jobs.set(String(i), { id: String(i), createdAt: new Date(1000).toISOString(), status: 'completed' });
  assert.equal((await (await request('/jobs')).json()).length, 100);
  assert.equal((await (await request('/jobs?offset=100')).json()).length, 10);
  const broken = await serve(t, { env: {} });
  assert.equal((await broken.request('/session', { anonymous: true })).status, 503);
});
