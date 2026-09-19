import { MODELS, normalizeTask } from '../shared/models.mjs';

const storageKey = 'frame-personal-key-v1';
const baseUrl = 'https://deepkey.top';
export function createBrowserProvider({ storage, fetcher = globalThis.fetch, crypto = globalThis.crypto } = {}) {
  let key = '', remember = false;
  try { storage ||= globalThis.localStorage; key = storage.getItem(storageKey) || ''; remember = !!key; } catch { /* Memory-only use still works. */ }
  async function settings() {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${baseUrl}\n${key}`));
    return { cloud: true, storage: 'indexeddb', baseUrl, hasKey: !!key, rememberKey: remember, connectionId: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''), keySource: key ? (remember ? '保存在此浏览器' : '仅当前页面') : '请配置自己的 API Key', models: MODELS };
  }
  async function upstream(path, options = {}) {
    if (!key) throw Object.assign(new Error('请在连接设置中填写自己的 API Key'), { status: 400 });
    let response;
    try {
      response = await fetcher(`/api/provider${path}`, { ...options, credentials: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: options.signal || AbortSignal.timeout(210000) });
    } catch {
      throw new Error('无法连接视频服务，请检查网络；生成提交结果可能待确认，请勿重复提交');
    }
    let data;
    try { data = await response.json(); } catch { throw new Error(`平台响应无法解析 (${response.status})`); }
    if (!response.ok || (data.error && !data.status)) {
      // Do not echo upstream bodies: some providers include submitted credentials in errors.
      throw Object.assign(new Error(`DeepKey 请求失败 (${response.status})，请检查 Key、余额和模型权限`), { status: response.status });
    }
    return data;
  }
  return async function request(path, options = {}) {
    const body = options.body ? JSON.parse(options.body) : {};
    if (path === '/settings') {
      if (options.method === 'PUT') {
        const nextKey = body.clearKey ? '' : String(body.apiKey || '').trim().replace(/^Bearer\s+/i, '') || key;
        if (/[\r\n]/.test(nextKey)) throw new Error('API Key 格式无效');
        const persist = !body.clearKey && !!body.rememberKey && !!nextKey;
        try { if (persist) storage.setItem(storageKey, nextKey); else storage?.removeItem(storageKey); }
        catch { throw new Error('无法更新浏览器密钥存储，请检查网站存储权限'); }
        key = nextKey; remember = persist;
      }
      return settings();
    }
    if (path === '/connection') {
      const data = await upstream('/models', { signal: AbortSignal.timeout(20000) });
      const ids = (data.data || []).map(m => m.id);
      return { models: ids.filter(id => MODELS.some(m => m.id === id)), total: ids.length };
    }
    const current = await settings();
    if (!key) throw Object.assign(new Error('请在连接设置中填写自己的 API Key'), { status: 400 });
    if (body.connectionId !== current.connectionId) throw Object.assign(new Error('API Key 已更改，请使用创建任务时的 Key'), { status: 409 });
    if (path === '/videos') {
      const { connectionId, ...payload } = body;
      const data = normalizeTask(await upstream('/videos', { method: 'POST', body: JSON.stringify(payload), signal: options.signal }));
      if (!data.remoteId) throw new Error('平台响应缺少任务 ID，请核对平台记录，切勿重复提交');
      return data;
    }
    if (path === '/videos/query') {
      if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(body.remoteId)) throw new Error('任务 ID 格式无效');
      const raw = await upstream(`/videos/${encodeURIComponent(body.remoteId)}`, { signal: AbortSignal.timeout(20000) });
      return { ...normalizeTask(raw), remoteId: body.remoteId, model: typeof raw.model === 'string' ? raw.model : '', seconds: Number.isFinite(raw.seconds) ? raw.seconds : null };
    }
    throw new Error('不支持的浏览器请求');
  };
}
