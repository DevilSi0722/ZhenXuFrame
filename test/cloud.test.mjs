import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCloudApp } from '../server/cloud-app.mjs';
import { security } from '../server/cloud-security.mjs';
import { MODELS } from '../shared/models.mjs';
import { MAX_REQUEST_BYTES } from '../shared/limits.mjs';

const env = { FRAME_PASSWORD: 'test-password-for-studio', DEEPKEY_API_KEY: 'test-provider-key', FRAME_CLOUD_DEV: '1' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
async function serve(t, options = {}) {
  const server = createServer(createCloudApp({ env, ...options }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const token = security(env).issue();
  return async (path, { body, method = body === undefined ? 'GET' : 'POST', anonymous = false, headers = {} } = {}) => fetch(origin + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(!anonymous && { Cookie: `frame_session=${token}` }), ...headers }, ...(body !== undefined && { body: JSON.stringify(body) }) });
}
test('password-only session signing expires and rejects password rotation or tampering', () => {
  const auth = security(env), token = auth.issue(1000);
  assert.equal(auth.verify(token, 2000), true);
  assert.equal(auth.verify(token, 8 * 86400000), false);
  assert.equal(auth.verify(token + 'x', 2000), false);
  assert.equal(security({ ...env, FRAME_PASSWORD: 'a-new-test-password' }).verify(token, 2000), false);
});
test('stateless deployment needs no storage credentials, protects API and never returns Key', async t => {
  const req = await serve(t);
  assert.equal((await req('/session', { anonymous: true })).status, 200);
  for (const path of ['/settings', '/videos', '/videos/query']) assert.equal((await req(path, { method: path === '/settings' ? 'GET' : 'POST', anonymous: true })).status, 401);
  assert.equal((await req('/settings', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const text = await (await req('/settings')).text();
  assert.ok(!text.includes(env.DEEPKEY_API_KEY)); assert.equal(JSON.parse(text).storage, 'indexeddb');
  assert.equal((await req('/settings', { method: 'PUT', body: { apiKey: 'ignored-key' } })).status, 400);
  assert.equal((await req('/jobs')).status, 404);
  const login = await req('/login', { anonymous: true, body: { password: env.FRAME_PASSWORD } });
  assert.match(login.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  const broken = await serve(t, { env: {} });
  assert.equal((await broken('/session')).status, 503);
});
test('reference POST forwards ordered images once; query normalizes failure responses', async t => {
  let calls = 0, sent;
  const req = await serve(t, { fetcher: async (_url, init) => {
    calls++;
    if (init.method === 'POST') { sent = JSON.parse(init.body); return json({ task_id: 'remote-1', status: 'queued' }); }
    return json({ status: 'failed', error: { message: 'provider rejection' } });
  } });
  const c = await (await req('/settings')).json();
  const body = { model: MODELS[0].id, prompt: 'Test', aspect_ratio: '16:9', connectionId: c.connectionId, images: ['data:image/png;base64,YQ==', 'https://example.com/ref.png'] };
  const result = await (await req('/videos', { body })).json();
  assert.equal(result.remoteId, 'remote-1'); assert.deepEqual(sent.images, body.images); assert.equal(sent.connectionId, undefined); assert.equal(calls, 1);
  const failure = await (await req('/videos/query', { body: { remoteId: 'remote-1', connectionId: c.connectionId } })).json();
  assert.equal(failure.status, 'failed'); assert.equal(failure.error, 'provider rejection');
  assert.equal((await req('/videos', { body: { ...body, connectionId: 'wrong' } })).status, 409); assert.equal(calls, 2);
});
test('uncertain POSTs are never retried, rejection is explicit, oversized requests rejected before upstream', async t => {
  let calls = 0;
  const req = await serve(t, { fetcher: async () => { calls++; throw new Error('connection lost'); } });
  const c = await (await req('/settings')).json();
  const body = { model: MODELS[0].id, prompt: 'Test', aspect_ratio: '16:9', connectionId: c.connectionId };
  assert.equal((await (await req('/videos', { body })).json()).status, 'unknown'); assert.equal(calls, 1);
  assert.equal((await req('/videos', { body: { ...body, images: ['data:image/png;base64,' + 'A'.repeat(MAX_REQUEST_BYTES)] } })).status, 413); assert.equal(calls, 1);
  const rejected = await serve(t, { fetcher: async () => json({ error: 'No credit' }, 400) });
  assert.equal((await (await rejected('/videos', { body })).json()).status, 'failed');
});
