import { useEffect, useState } from 'react';
import { Clapperboard, LockKeyhole } from 'lucide-react';
import { api, post, setCloudMode } from './api';
import App from './App';

export default function Session() {
  const [session, setSession] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function check() {
    setError('');
    try { const value = await api('/session'); setCloudMode(value.cloud); setSession(value); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { check(); const expired = () => setSession({ cloud: true, authenticated: false }); window.addEventListener('frame-session-expired', expired); return () => window.removeEventListener('frame-session-expired', expired); }, []);
  if (session?.authenticated) return <App cloud={session.cloud} logout={async () => { await post('/logout'); setSession({ cloud: true, authenticated: false }); }} />;
  return <main className="login-page"><section className="login-card"><span className="brand-icon"><Clapperboard size={26} /></span><h1>帧序 FRAME</h1><p>登录你的私人视频工作台</p>{session ? <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await post('/login', { password }); setPassword(''); await check(); } catch (e) { setError(e.message); } finally { setBusy(false); } }}><label htmlFor="studio-password">工作台密码</label><input id="studio-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /><button className="primary" disabled={busy}><LockKeyhole size={16} />{busy ? '正在登录…' : '进入工作台'}</button></form> : error ? <button className="secondary" onClick={check}>重试连接</button> : <p role="status">正在连接工作台…</p>}{error && <p className="inline-error" role="alert">{error}</p>}</section></main>;
}
