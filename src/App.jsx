import { useCallback, useEffect, useRef, useState } from 'react';
import { Clapperboard, Plus, PanelsTopLeft, History as HistoryIcon, Settings2, ExternalLink, ChevronRight, CheckCircle2, AlertCircle, X, ArrowLeft } from 'lucide-react';
import Composer, { DEFAULT_DRAFT, SAMPLE_PROMPT } from './Composer';
import { Preview, RecentJobs, History } from './Workspace';
import Settings from './Settings';
import { IconButton } from './components';
import { api, post, readDraft, fileData } from './api';
import { buildPayload, MODELS } from '../shared/models.mjs';

export default function App({ cloud = false, logout }) {
  const [page, setPage] = useState('create');
  const [settings, setSettings] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [moreHistory, setMoreHistory] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(() => { const saved = readDraft(); return { ...DEFAULT_DRAFT, ...saved, model: MODELS.some(m => m.id === saved.model) ? saved.model : DEFAULT_DRAFT.model, images: [] }; });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [loadError, setLoadError] = useState('');
  const locked = useRef(false);
  const token = useRef(crypto.randomUUID());
  const notify = useCallback((message, error = false) => setToast({ message, error }), []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.error ? 12000 : 4500); return () => clearTimeout(timer); }, [toast]);
  const mergeJobs = useCallback(data => setJobs(current => [...new Map([...current, ...data].map(job => [job.id, job])).values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))), []);
  const loadJobs = useCallback(async () => { const data = await api('/jobs'); mergeJobs(data); return data; }, [mergeJobs]);
  async function loadEarlier() { setLoadingHistory(true); try { const data = await api('/jobs?offset=' + jobs.length); mergeJobs(data); setMoreHistory(data.length === 100); } catch (error) { notify(error.message, true); } finally { setLoadingHistory(false); } }
  useEffect(() => {
    let active = true;
    Promise.all([api('/settings'), api('/jobs')]).then(([config, items]) => { if (active) { setSettings(config); setJobs(items); setMoreHistory(items.length === 100); } }).catch(error => setLoadError(error.message));
    let timer;
    const poll = async () => { try { if (cloud && document.visibilityState === 'visible') await post('/jobs/sync'); const data = await api('/jobs'); if (active) { mergeJobs(data); setLoadError(''); } } catch { if (active) setLoadError('服务连接中断，任务信息将在重连后恢复'); } finally { if (active) timer = setTimeout(poll, cloud ? 15000 : 4000); } };
    timer = setTimeout(poll, cloud ? 15000 : 4000);
    return () => { active = false; clearTimeout(timer); };
  }, [cloud, mergeJobs]);
  function newCreation() { setPage('create'); setSelectedId(null); setDraft({ ...DEFAULT_DRAFT }); token.current = crypto.randomUUID(); }
  function select(id) { setSelectedId(id); setPage('create'); }
  async function submit() {
    if (locked.current) return;
    try {
      if (draft.mode === 'image' && !draft.images.length) throw new Error('请添加至少一张参考图，或切换为文字生视频');
      const lines = text => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const payload = buildPayload({ ...draft, images: draft.mode === 'image' ? draft.images.map(image => image.value) : [], metadata: { video_urls: lines(draft.videoUrls), audio_urls: lines(draft.audioUrls) } });
      locked.current = true; setSubmitting(true);
      const job = await post('/jobs', { ...payload, requestToken: token.current });
      token.current = crypto.randomUUID();
      mergeJobs([job]); setSelectedId(job.id); await loadJobs();
      if (['unknown', 'failed'].includes(job.status)) notify(job.error || '任务提交失败', true); else notify('任务已提交，正在等待生成');
    } catch (error) { notify(error.message, true); }
    finally { locked.current = false; setSubmitting(false); }
  }
  async function refresh(id) { try { const job = await post(`/jobs/${id}/refresh`); mergeJobs([job]); await loadJobs(); if (job.pollError) notify(job.pollError, true); else notify('任务状态已更新'); } catch (error) { notify(error.message, true); } }
  async function reuse(id) {
    try { const payload = await api(`/jobs/${id}/draft`); setDraft({ ...DEFAULT_DRAFT, ...payload, mode: payload.images?.length ? 'image' : 'text', images: (payload.images || []).map((value, i) => ({ name: `参考图片 ${i + 1}`, value })), videoUrls: (payload.metadata?.video_urls || []).join('\n'), audioUrls: (payload.metadata?.audio_urls || []).join('\n') }); token.current = crypto.randomUUID(); setPage('create'); notify('已载入生成参数'); } catch (error) { notify(error.message, true); }
  }
  async function useSample() {
    try { const response = await fetch('/generated/lake.png'); if (!response.ok) throw new Error('参考图读取失败'); const blob = await response.blob(); const reference = await fileData(new File([blob], '山间晨光.png', { type: blob.type })); setDraft(current => ({ ...current, mode: 'image', prompt: `@图片1 作为场景参考。${SAMPLE_PROMPT}`, images: [reference] })); token.current = crypto.randomUUID(); notify('已载入参考图与提示词'); } catch { notify('无法载入灵感参考图', true); }
  }
  const selected = jobs.find(job => job.id === selectedId);
  return <div className="app-shell"><aside className="sidebar"><a href="#" className="brand" onClick={e => { e.preventDefault(); setPage('create'); }}><span className="brand-icon"><Clapperboard size={23} /></span><div><strong>帧序 <span>FRAME</span></strong><small>VIDEO STUDIO</small></div></a><button className="new-button" onClick={newCreation}><Plus size={17} />新建创作</button><nav aria-label="主导航">{[['create', PanelsTopLeft, '创作工作台'], ['history', HistoryIcon, '任务历史'], ['settings', Settings2, '连接设置']].map(([id, Icon, label]) => <button key={id} aria-label={label} onClick={() => setPage(id)} className={page === id ? 'active' : ''}><Icon size={18} /><span>{label}</span>{page === id && <ChevronRight size={14} />}</button>)}</nav><div className="sidebar-bottom"><a className="docs-link" href="https://doc.deepkey.top/#guide-seedance-video" target="_blank" rel="noreferrer"><ExternalLink size={15} /><span>DeepKey 文档</span></a><button className="connection-tile" onClick={() => setPage('settings')}><span className={`dot ${settings?.hasKey ? 'green' : ''}`} /><div><strong>{settings?.hasKey ? 'API 已配置' : 'API 未配置'}</strong><small>DeepKey · Seedance</small></div><Settings2 size={15} /></button><span className="local-label">{cloud ? '私人云端工作空间' : '本地工作空间'} <span>v1.1</span></span></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">工作空间<ChevronRight size={13} /><strong>{page === 'create' ? '视频创作' : page === 'history' ? '任务历史' : '连接设置'}</strong></div><span className="topbar-right"><span className="dot green" />{cloud ? '云端存储' : '本地存储'}{cloud && <button className="text-button" onClick={() => logout().catch(error => notify(error.message, true))}>退出登录</button>}</span></header>{loadError && <div role="alert" className="service-error">{loadError}</div>}
    {page === 'create' ? <main className="studio"><Composer draft={draft} setDraft={setDraft} submit={submit} submitting={submitting} configured={settings?.hasKey} openSettings={() => setPage('settings')} notify={notify} /><div className="workspace">{selected && <button className="text-button back-preview" onClick={() => setSelectedId(null)}><ArrowLeft size={14} />返回灵感预览</button>}<Preview key={selected?.id || 'inspiration'} job={selected} refresh={refresh} reuse={reuse} useSample={useSample} notify={notify} /><RecentJobs jobs={jobs} selectedId={selectedId} select={select} showHistory={() => setPage('history')} /><footer className="workspace-footer"><Clapperboard size={14} /><span>每一帧，都从一个想法开始。</span><span>POWERED BY SEEDANCE</span></footer></div></main> : page === 'history' ? <History loadEarlier={cloud && moreHistory ? loadEarlier : null} loadingHistory={loadingHistory} jobs={jobs} select={select} importJob={async remoteId => { try { const job = await post('/jobs/import', { remoteId }); mergeJobs([job]); await loadJobs(); select(job.id); notify('任务已导入'); return true; } catch (error) { notify(error.message, true); return false; } }} /> : settings ? <Settings settings={settings} setSettings={setSettings} notify={notify} /> : <div className="loading-state">{loadError || '正在读取连接设置…'}</div>}
    </div>{toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><IconButton title="关闭消息" onClick={() => setToast(null)}><X size={16} /></IconButton></div>}</div>;
}

