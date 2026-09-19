import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, buildPayload, normalizeTask, isDone } from '../shared/models.mjs';

const input = () => ({ model: MODELS[0].id, prompt: '晨光下的湖泊', aspect_ratio: '16:9', seconds: 15 });
test('fixed models omit seconds; variable models validate integer duration', () => {
  for (const model of MODELS) {
    const payload = buildPayload({ ...input(), model: model.id, seconds: 8 });
    assert.equal(payload.seconds, model.seconds ? undefined : 8);
  }
  for (const seconds of [4, 16, 8.5, '8']) assert.throws(() => buildPayload({ ...input(), model: MODELS[2].id, seconds }));
});
test('image order and mixed reference fields are preserved with limits', () => {
  const images = ['https://example.com/a.png', 'data:image/png;base64,YQ=='];
  const metadata = { video_urls: ['https://example.com/a.mp4'], audio_urls: ['https://example.com/b.mp3'] };
  assert.deepEqual(buildPayload({ ...input(), images, metadata }).images, images);
  assert.deepEqual(buildPayload({ ...input(), images, metadata }).metadata, metadata);
  assert.throws(() => buildPayload({ ...input(), images: Array(10).fill(images[0]) }));
  assert.throws(() => buildPayload({ ...input(), metadata: { video_urls: Array(4).fill(metadata.video_urls[0]) } }));
  assert.throws(() => buildPayload({ ...input(), images: ['javascript:alert(1)'] }));
  assert.throws(() => buildPayload({ ...input(), prompt: ' ' }));
});
test('normalize task uses documented fallbacks; only status determines completion', () => {
  const task = normalizeTask({ id: '', task_id: 'task_123', status: 'processing', progress: 100, metadata: { url: '' }, result_url: 'https://example.com/video.mp4' });
  assert.equal(task.remoteId, 'task_123');
  assert.equal(task.url, 'https://example.com/video.mp4');
  assert.equal(isDone(task.status), false);
  assert.equal(normalizeTask({ metadata: { url: 'https://example.com/first.mp4' }, url: 'https://example.com/second.mp4' }).url, 'https://example.com/first.mp4');
  assert.equal(normalizeTask({ status: 'failed', error: { message: 'invalid reference' } }).error, 'invalid reference');
  assert.equal(isDone('succeeded'), true);
});
