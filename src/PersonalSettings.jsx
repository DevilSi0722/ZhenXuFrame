import { useState } from 'react';
import { Eye, EyeOff, Save, PlugZap, Unplug } from 'lucide-react';
import { api, post } from './api';
import { IconButton } from './components';
import './personal-settings.css';

export default function PersonalSettings({ settings, setSettings, notify }) {
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(!!settings.rememberKey);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  async function apply(test = false, clear = false) {
    setBusy(true);
    setConnectionError('');
    try {
      const result = await api('/settings', { method: 'PUT', body: JSON.stringify({ apiKey: key, rememberKey: remember, clearKey: clear }) });
      setSettings(result); setKey(''); setRemember(result.rememberKey);
      if (test) {
        const connection = await post('/connection');
        notify(connection.models.length ? '连接成功' : '连接成功，但此 Key 没有可用的 Seedance 模型', !connection.models.length);
      } else notify(clear ? '已清除 API Key' : '配置已保存');
    } catch (error) { setConnectionError(error.message); notify(error.message, true); }
    finally { setBusy(false); }
  }
  return <main className="settings-page"><div className="page-heading"><div><h1>连接设置</h1><p>DeepKey / Seedance</p></div></div>
    <section className="settings-section"><h2><PlugZap size={19} />个人 API Key</h2>
      <p className="settings-note">API 地址：https://deepkey.top</p>
      <form onSubmit={e => { e.preventDefault(); apply(); }}>
        <label htmlFor="personal-api-key">API Key</label>
        <div className="key-input"><input id="personal-api-key" type={visible ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={key} placeholder={settings.hasKey ? '已配置，留空保留当前密钥' : '填写自己的 DeepKey API Key'} onChange={e => setKey(e.target.value)} /><IconButton title={visible ? '隐藏密钥' : '显示密钥'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</IconButton></div>
        <label className="remember-key"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />在此浏览器记住 API Key</label>
        <p className="settings-note">不勾选时仅在当前页面使用，刷新后需重新填写。勾选后保存在此浏览器的网站数据中，请勿在公共设备上保存。</p>
        <p className="settings-note">生成、查询及测试连接时，密钥临时经过 Vercel 转发给 DeepKey 鉴权，本站不会在服务器保存密钥。备份不包含密钥。</p>
        <div className="credential-status"><span className={`dot ${settings.hasKey ? 'green' : ''}`} />{settings.keySource}</div>
        {connectionError && <p role="alert" className="inline-error">{connectionError}</p>}
        <div className="settings-actions"><button type="submit" className="primary" disabled={busy}><Save size={15} />保存设置</button><button type="button" className="secondary" disabled={busy} onClick={() => apply(true)}><PlugZap size={15} />{busy ? '处理中…' : '保存并测试连接'}</button></div>
      </form>
      <div className="key-tools"><button type="button" className="text-button danger" disabled={busy} onClick={() => apply(false, true)}><Unplug size={15} />清除 API Key</button></div>
    </section>
  </main>;
}
