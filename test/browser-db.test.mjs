import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createBrowserDB, parseBackup, displayJob } from '../src/browser-db.mjs';
import { createBrowserJobs } from '../src/browser-jobs.mjs';
import { prepareCloudPayload } from '../src/reference-images.mjs';
import { MODELS } from '../shared/models.mjs';
import { MAX_REQUEST_BYTES } from '../shared/limits.mjs';

const settings = { cloud: true, hasKey: true, baseUrl: 'https://deepkey.top', connectionId: 'a'.repeat(64) };
const payload = { model: MODELS[0].id, prompt: 'Test scene', aspect_ratio: '16:9', images: ['data:image/png;base64,YQ=='] };
const body = { ...payload, requestToken: 'request-token-12345678' };
const newDB = () => createBrowserDB({ indexedDB: new IDBFactory() });
const submit = service => service.route('/jobs', { method: 'POST', body: JSON.stringify(body) });

test('two tabs reserve a request atomically before one paid POST; restart preserves inputs and state', async () => {
  const indexedDB = new IDBFactory();
  const a = createBrowserDB({ indexedDB }), b = createBrowserDB({ indexedDB });
  let posts = 0;
  const request = async (path, options) => {
    if (path === '/settings') return settings;
    if (path === '/videos') {
      posts++;
      assert.equal((await a.list()).length, 1);
      assert.deepEqual(await a.payload((await a.list())[0].id), payload);
      return { remoteId: 'remote-1', status: 'queued' };
    }
    return { remoteId: 'remote-1', status: 'completed', url: 'https://example.com/video.mp4' };
  };
  const sa = createBrowserJobs({ db: a, request, prepare: async p => p });
  const sb = createBrowserJobs({ db: b, request, prepare: async p => p });
  const [ja, jb] = await Promise.all([submit(sa), submit(sb)]);
  assert.equal(ja.id, jb.id); assert.equal(posts, 1);
  const cold = createBrowserJobs({ db: createBrowserDB({ indexedDB }), request });
  const jobs = await cold.route('/jobs'); assert.equal(jobs[0].remoteId, 'remote-1');
  await cold.route('/jobs/sync'); assert.equal((await a.list())[0].status, 'completed');
  await submit(cold); assert.equal(posts, 1);
});
test('storage refusal stops paid requests; network uncertainty is stored and never resubmitted', async () => {
  let posts = 0;
  const request = async path => { if (path === '/settings') return settings; posts++; throw new Error('network down'); };
  const blocked = createBrowserJobs({ db: { reserve: async () => { throw new Error('QuotaExceededError'); } }, request, prepare: async p => p });
  await assert.rejects(submit(blocked), /QuotaExceededError/); assert.equal(posts, 0);
  const db = newDB(); const service = createBrowserJobs({ db, request, prepare: async p => p });
  const job = await submit(service); assert.equal(job.status, 'unknown'); assert.equal(posts, 1);
  await submit(service); assert.equal(posts, 1);
  await db.update(job.id, { status: 'submitting', createdAt: new Date(Date.now() - 300000).toISOString() });
  assert.equal((await service.route('/jobs'))[0].status, 'unknown');
  assert.equal((await db.get(job.id)).status, 'submitting'); // A late remote-ID write can still succeed.
});
test('received ID survives a failure to save response and remains available for recovery', async () => {
  const db = newDB();
  const update = db.update;
  db.update = async () => { throw new Error('disk full'); };
  const service = createBrowserJobs({ db, prepare: async p => p, request: async path => path === '/settings' ? settings : { status: path === '/videos/query' ? 'completed' : 'queued', remoteId: 'important-id' } });
  await assert.rejects(submit(service), error => error.recoveryJob.remoteId === 'important-id' && error.message.includes('important-id'));
  assert.equal((await service.backup()).jobs[0].remoteId, 'important-id');
  db.update = update;
  await service.route('/jobs/sync');
  assert.equal((await service.route('/jobs'))[0].status, 'completed');
  assert.equal((await db.list())[0].remoteId, 'important-id');
});
test('legacy task import binds the connection while preserving original inputs', async () => {
  const db = newDB();
  await db.reserve({ id: 'legacy-job', requestToken: 'legacy-request-12345678', createdAt: new Date().toISOString(), baseUrl: settings.baseUrl, remoteId: 'legacy-remote', status: 'queued', model: payload.model }, payload);
  const service = createBrowserJobs({ db, request: async path => path === '/settings' ? settings : { remoteId: 'legacy-remote', status: 'completed' } });
  const job = await service.route('/jobs/import', { method: 'POST', body: JSON.stringify({ remoteId: 'legacy-remote' }) });
  assert.equal(job.id, 'legacy-job');
  assert.equal(job.connectionId, settings.connectionId);
  assert.equal((await db.list()).length, 1);
  assert.deepEqual(await db.payload(job.id), payload);
});
test('backup round trip preserves images, strips secrets, skips duplicates and validates before import', async () => {
  const db = newDB();
  const job = { id: 'local-id', requestToken: 'local-request-12345678', createdAt: new Date().toISOString(), baseUrl: settings.baseUrl, connectionId: settings.connectionId, model: payload.model, prompt: payload.prompt, status: 'submitting', apiKey: 'must-not-export', keyFingerprint: 'old-fingerprint' };
  await db.reserve(job, payload);
  const backup = await db.exportBackup();
  assert.ok(!JSON.stringify(backup).includes('must-not-export')); assert.ok(!JSON.stringify(backup).includes('keyFingerprint'));
  assert.equal(backup.jobs[0].status, 'unknown');
  const other = newDB(); assert.deepEqual(await other.importBackup(backup), { imported: 1, skipped: 0 });
  assert.deepEqual(await other.payload(job.id), payload);
  assert.equal((await other.get(job.id)).browserStored, true);
  assert.deepEqual(await other.importBackup(backup), { imported: 0, skipped: 1 });
  const bad = { ...backup, jobs: [...backup.jobs, { ...job, id: 'new-id', url: 'javascript:alert(1)', baseUrl: 'file:///secrets' }] };
  await assert.rejects(other.importBackup(bad)); assert.equal((await other.list()).length, 1);
  assert.equal(parseBackup([{ ...job, status: 'completed', url: 'javascript:alert(1)', payload }])[0].job.url, undefined);
});
test('compression keeps image order and request below Vercel budget; large results refused', async () => {
  const images = ['data:image/png;base64,YQ==', 'https://example.com/b.png', 'data:image/png;base64,Yg=='];
  let index = 0;
  const result = await prepareCloudPayload({ ...payload, images }, async (value, limit) => { assert.equal(limit, 1300000); index++; return value; });
  assert.equal(index, 2); assert.deepEqual(result.images, images);
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).length < MAX_REQUEST_BYTES);
  await assert.rejects(prepareCloudPayload({ ...payload, images: ['data:image/png;base64,' + 'A'.repeat(MAX_REQUEST_BYTES)] }, async p => p), /总大小/);
});
test('changed provider connection blocks polling without disclosing old task IDs', async () => {
  const db = newDB(); let queries = 0;
  await db.reserve({ id: 'old-job', requestToken: 'old-request-12345678', createdAt: new Date().toISOString(), baseUrl: settings.baseUrl, connectionId: 'b'.repeat(64), status: 'queued', remoteId: 'old-remote' });
  const service = createBrowserJobs({ db, request: async path => { if (path === '/settings') return settings; queries++; } });
  await service.route('/jobs/sync'); assert.equal(queries, 0); assert.match((await db.get('old-job')).pollError, /其他连接/);
  assert.equal(displayJob({ status: 'completed' }).status, 'completed');
});
