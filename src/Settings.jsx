import { useState } from 'react';
import { KeyRound, Link2, CheckCircle2, ExternalLink, Save, Unplug, PlugZap, Eye, EyeOff } from 'lucide-react';
import { api, post } from './api';
import { IconButton } from './components';
import { MODELS } from '../shared/models.mjs';

export default function Settings({ settings, setSettings, notify }) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl || 'https://deepkey.top');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState(null);
  async function save(extra = {}) {
    const result = await api('/settings', { method: 'PUT', body: JSON.stringify({ baseUrl, apiKey, ...extra }) });
    setSettings(result); setApiKey(''); setConnection(null); return result;
  }
  async function act(action) {
    setBusy(true); try { await action(); } catch (error) { notify(error.message, true); } finally { setBusy(false); }
  }
  return <main className="settings-page"><div className="page-heading"><div><h1>连接设置</h1><p>DeepKey / Seedance</p></div><a className="secondary" href="https://doc.deepkey.top/#guide-seedance-video" target="_blank" rel="noreferrer">接口文档<ExternalLink size={15} /></a></div>
    <section className="settings-section"><h2><PlugZap size={19} />API 连接</h2><form onSubmit={e => { e.preventDefault(); act(async () => { await save(); notify('连接配置已保存'); }); }}><label htmlFor="base-url"><Link2 size={14} />API 根地址</label><input id="base-url" type="url" readOnly={settings.cloud} required value={baseUrl} onChange={e => { setBaseUrl(e.target.value); setConnection(null); }} /><label htmlFor="api-key"><KeyRound size={14} />API Key</label><div className="key-input"><input id="api-key" type={showKey ? 'text' : 'password'} autoComplete="off" placeholder={settings.hasKey ? '已配置，留空保留当前密钥' : 'sk-…'} value={apiKey} onChange={e => { setApiKey(e.target.value); setConnection(null); }} /><IconButton title={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</IconButton></div><div className="credential-status"><span className={`dot ${settings.hasKey ? 'green' : ''}`} />{settings.keySource}</div><p className="settings-note">{settings.cloud ? '密钥仅由服务端使用，手动保存时加密存储。API 根地址通过部署环境变量配置。' : '密钥仅由本机后端使用，不写入浏览器存储。手动保存的密钥存放于本地 .local/settings.json；此目录已排除版本控制。'}</p><div className="settings-actions"><button type="submit" className="primary" disabled={busy}><Save size={15} />保存设置</button><button type="button" className="secondary" disabled={busy} onClick={() => act(async () => { await save(); const result = await post('/connection'); setConnection(result); notify(result.models.length ? `连接成功，可用视频模型 ${result.models.length} 个` : '连接成功，但当前 Key 未开放 Seedance 模型', !result.models.length); })}><PlugZap size={15} />{busy ? '处理中…' : '保存并测试连接'}</button></div></form>
    <div className="key-tools"><button className="text-button" disabled={busy} onClick={() => act(async () => { await save({ useLocalKey: true, apiKey: '' }); notify(settings.cloud ? '已切换到部署环境凭据' : '已切换到本机 DeepKey 凭据'); })}>{settings.cloud ? '使用部署环境凭据' : '使用本机凭据'}</button><button className="text-button danger" disabled={busy} onClick={() => act(async () => { await save({ clearKey: true, apiKey: '' }); notify('已断开 API 连接'); })}><Unplug size={13} />断开连接</button></div></section>
    <section className="settings-section"><div className="section-heading"><h2>Seedance 模型</h2><span className="muted">720p · 标准价参考</span></div>{connection && <div className={`connection-result ${connection.models.length ? '' : 'warning'}`}><CheckCircle2 size={16} />{connection.models.length ? `鉴权成功 · ${connection.models.length} 个视频模型可用` : '鉴权成功，未找到 Seedance 模型，请检查 Key 分组'}</div>}<div className="model-table"><div className="model-table-row table-header"><span>模型</span><span>时长</span><span>价格</span></div>{MODELS.map(model => <div className="model-table-row" key={model.id}><div><strong>{model.name}{connection?.models.includes(model.id) && <CheckCircle2 size={13} />}</strong><small>{model.id}</small></div><span>{model.seconds ? `${model.seconds} 秒` : '5–15 秒'}</span><span>¥{model.seconds ? (model.seconds * model.rate).toFixed(2) + '/次' : model.rate.toFixed(2) + '/秒'}</span></div>)}</div></section>
  </main>;
}
