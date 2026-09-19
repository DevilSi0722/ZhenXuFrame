export const MODELS = [
  { id: 'sd2.0-mini933-720p-x10s', name: 'Seedance 2.0 Mini', label: 'Mini · 10 秒', seconds: 10, rate: 0.15 },
  { id: 'sd2.0-mini933-720p-x15s', name: 'Seedance 2.0 Mini', label: 'Mini · 15 秒', seconds: 15, rate: 0.15 },
  { id: 'sd2.0-mini933-720p-x5-15s', name: 'Seedance 2.0 Mini', label: 'Mini · 自定义时长', seconds: null, rate: 0.15 },
  { id: 'sd2.0-933-720p-fast-x10s', name: 'Seedance 2.0 Fast', label: 'Fast · 10 秒', seconds: 10, rate: 0.25 },
  { id: 'sd2.0-933-720p-fast-x15s', name: 'Seedance 2.0 Fast', label: 'Fast · 15 秒', seconds: 15, rate: 0.25 },
  { id: 'sd2.0-933-720p-fast-x5-15s', name: 'Seedance 2.0 Fast', label: 'Fast · 自定义时长', seconds: null, rate: 0.25 },
];
export const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '3:2', '2:3'];
export const isDone = status => ['completed', 'succeeded', 'failed'].includes(status);
export const isSuccess = status => ['completed', 'succeeded'].includes(status);
export const statusLabel = status => ({ submitting: '正在提交', unknown: '提交待确认', queued: '排队中', processing: '生成中', in_progress: '生成中', completed: '已完成', succeeded: '已完成', failed: '失败' }[status] || status || '等待查询');
export function publicUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}
export function buildPayload(input) {
  const model = MODELS.find(m => m.id === input.model);
  if (!model) throw new Error('请选择教程支持的 Seedance 模型');
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw new Error('请填写视频提示词');
  if (!RATIOS.includes(input.aspect_ratio)) throw new Error('不支持的画面比例');
  const payload = { model: model.id, prompt: input.prompt.trim(), aspect_ratio: input.aspect_ratio };
  if (!model.seconds) {
    if (!Number.isInteger(input.seconds) || input.seconds < 5 || input.seconds > 15) throw new Error('时长必须是 5–15 秒的整数');
    payload.seconds = input.seconds;
  }
  const images = input.images ?? [];
  if (!Array.isArray(images) || images.length > 9) throw new Error('参考图最多 9 张');
  if (images.some(image => typeof image !== 'string' || !(publicUrl(image) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)))) throw new Error('参考图必须为图片地址或 PNG / JPEG / WebP 文件');
  if (images.length) payload.images = images;
  for (const field of ['video_urls', 'audio_urls']) {
    const values = input.metadata?.[field] ?? [];
    if (!Array.isArray(values) || values.length > 3 || values.some(url => !publicUrl(url))) throw new Error('参考视频和音频各最多 3 个有效 HTTP(S) 地址');
    if (values.length) { payload.metadata ??= {}; payload.metadata[field] = values; }
  }
  return payload;
}
export function normalizeTask(data) {
  const error = typeof data.error === 'string' ? data.error : data.error?.message || data.fail_reason;
  const url = [data.metadata?.url, data.result_url, data.url].find(value => typeof value === 'string' && value.length > 0 && publicUrl(value));
  return {
    remoteId: data.id || data.task_id || undefined,
    status: typeof data.status === 'string' ? data.status : 'queued',
    progress: Number.isFinite(Number(data.progress)) ? Math.max(0, Math.min(100, Number(data.progress))) : null,
    ...(url ? { url } : {}), ...(error ? { error } : {}),
  };
}
