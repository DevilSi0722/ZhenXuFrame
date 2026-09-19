import { useEffect, useState } from 'react';
import { api, setCloudMode } from './api';
import App from './App';

export default function Session() {
  const [environment, setEnvironment] = useState(null);
  const [error, setError] = useState('');
  async function check() {
    setError('');
    try { const value = await api('/session'); setCloudMode(value.cloud); setEnvironment(value); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { check(); }, []);
  if (environment) return <App cloud={environment.cloud} />;
  return <main className="loading-state">{error ? <><p role="alert">{error}</p><button className="secondary" onClick={check}>重试连接</button></> : <p role="status">正在连接工作台…</p>}</main>;
}
