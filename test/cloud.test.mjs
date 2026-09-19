import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCloudApp } from '../server/cloud-app.mjs';
import { MODELS } from '../shared/models.mjs';

test('workspace opens without password configuration or cookies; old auth and shared-key routes are removed', async t => {
  const env = { FRAME_CLOUD_DEV: '1', DEEPKEY_API_KEY: 'must-never-be-used' };
  let calls = 0;
  const server = createServer(createCloudApp({ env, fetcher: () => { calls++; } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  const bootstrap = await fetch(origin + '/session');
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.headers.get('set-cookie'), null);
  const session = await bootstrap.json();
  assert.equal(session.authenticated, true);
  for (const path of ['/login', '/logout', '/settings', '/connection', '/videos', '/videos/query']) {
    const response = await fetch(origin + path, { method: path === '/settings' ? 'GET' : 'POST' });
    assert.equal(response.status, 404);
    assert.ok(!(await response.text()).includes(env.DEEPKEY_API_KEY));
  }
  assert.equal(calls, 0);
  assert.equal((await fetch(origin + '/session', { headers: { Origin: 'https://evil.example' } })).status, 403);
});
test('relay requires personal credentials and never reuses another visitors key', async t => {
  const env = { FRAME_CLOUD_DEV: '1', DEEPKEY_API_KEY: 'owner-key' };
  const sent = [];
  const server = createServer(createCloudApp({ env, fetcher: async (url, options) => { sent.push({ url, key: options.headers.Authorization, body: options.body }); return new Response(JSON.stringify({ data: [] })); } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/api/provider/models`;
  assert.equal((await fetch(url)).status, 400);
  for (const key of ['visitor-a', 'visitor-b']) {
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${key}` } })).status, 200);
  }
  assert.equal((await fetch(url)).status, 400);
  assert.deepEqual(sent.map(r => r.key), ['Bearer visitor-a', 'Bearer visitor-b']);
  assert.ok(sent.every(r => r.url === 'https://deepkey.top/v1/models'));
  const videoUrl = url.replace('/models', '/videos');
  const payload = { model: MODELS[0].id, prompt: 'test', aspect_ratio: '16:9', images: ['data:image/png;base64,YQ=='], apiKey: 'must-not-forward-in-body' };
  const response = await fetch(videoUrl, { method: 'POST', headers: { Authorization: 'Bearer visitor-c', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(response.status, 200);
  assert.equal(sent[2].key, 'Bearer visitor-c');
  assert.equal(sent[2].url, 'https://deepkey.top/v1/videos');
  assert.deepEqual(JSON.parse(sent[2].body).images, payload.images);
  assert.equal(JSON.parse(sent[2].body).apiKey, undefined);
});
