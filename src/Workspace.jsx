import { useRef, useState } from 'react';
import { ArrowDownToLine, Copy, Expand, Film, Image, RefreshCw, ArrowUpRight, Clock3, LoaderCircle, Search, Import, Play, X } from 'lucide-react';
import { IconButton, Status } from './components';
import { MODELS, isSuccess, isDone } from '../shared/models.mjs';

const time = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export function Preview({ job, refresh, reuse, useSample, notify }) {
  const media = useRef(null);
  const [mediaError, setMediaError] = useState('');
  async function fullscreen() {
    try { await media.current.requestFullscreen(); } catch { notify('当前浏览器不支持全屏预览', true); }
  }
  async function copyId() { try { await navigator.clipboard.writeText(job.remoteId); notify('任务 ID 已复制'); } catch { notify('无法访问剪贴板', true); } }
  const completed = job && isSuccess(job.status);
  const loading = job && !isDone(job.status) && job.status !== 'unknown';
  return <section className="preview-section">
    <div className="section-heading"><div><h2>{job ? '视频预览' : '创作预览'}</h2><span className="muted">{job ? `${job.ratio || '原始比例'} · 720p${job.seconds ? ` · ${job.seconds} 秒` : ''}` : '山间晨光'}</span></div><IconButton title="全屏预览" onClick={fullscreen}><Expand size={17} /></IconButton></div>
    <div className={`preview-media ${job ? 'task-media' : ''}`} ref={media}>
      {!job ? <><img className="inspiration-image" src="/generated/lake.png" alt="晨光下的翡翠色山间湖泊与木船" /><span className="image-caption"><Image size={13} />灵感参考图 · 非生成视频</span></> : completed ? <video key={job.url || job.id} controls playsInline preload="metadata" src={job.url || `${job.baseUrl}/v1/videos/${encodeURIComponent(job.remoteId)}/content`} onError={() => setMediaError('视频暂时无法播放，请刷新任务地址或下载文件')} /> : <div className="task-state">{loading ? <LoaderCircle size={34} className="spin" /> : <Film size={34} />}<Status status={job.status} />{loading && job.progress !== null && <><div className="progress-track"><div style={{ width: `${job.progress || 0}%` }} /></div><span className="muted">{job.progress || 0}%</span></>}{job.error && <p className="error-text">{job.error}</p>}</div>}
    </div>
    {mediaError && <p className="inline-error">{mediaError}</p>}
    {!job ? <div className="inspiration-info"><div><span className="mini-label">INSPIRATION 01</span><h3>让静止的风景，开始流动。</h3><p>山间晨光 / 平稳推镜 / 电影质感</p></div><button className="secondary" onClick={useSample}>使用此灵感<ArrowUpRight size={16} /></button></div> : <div className="job-detail"><div className="job-actions"><Status status={job.status} /><div>{job.remoteId && <IconButton title="刷新任务" onClick={() => { setMediaError(''); refresh(job.id); }}><RefreshCw size={16} /></IconButton>}<button className="secondary" onClick={() => reuse(job.id)}><Copy size={14} />复用参数</button>{completed && <a className="primary download" href={`/api/jobs/${job.id}/download`}><ArrowDownToLine size={15} />下载视频</a>}</div></div><p className="job-prompt">{job.prompt}</p>{job.pollError && <p className="inline-error">查询暂不可用：{job.pollError}</p>}<div className="job-meta"><span>{time(job.createdAt)}</span>{job.remoteId && <button className="text-button task-id" title={job.remoteId} onClick={copyId}>{job.remoteId}<Copy size={12} /></button>}</div></div>}
  </section>;
}

export function RecentJobs({ jobs, selectedId, select, showHistory }) {
  return <section className="recent-section"><div className="section-heading"><div><h2>最近任务</h2><span className="count">{jobs.length}</span></div><button className="text-button" onClick={showHistory}>全部任务<ArrowUpRight size={14} /></button></div>{jobs.length ? <div className="recent-list">{jobs.slice(0, 3).map(job => <button className={`recent-job ${selectedId === job.id ? 'chosen' : ''}`} key={job.id} onClick={() => select(job.id)}><div className="task-thumb">{isSuccess(job.status) ? <Play size={20} /> : <Film size={20} />}</div><div><strong>{job.prompt}</strong><span>{MODELS.find(m => m.id === job.model)?.label || '导入任务'} · {time(job.createdAt)}</span></div><Status status={job.status} /></button>)}</div> : <div className="empty-recent"><Clock3 size={22} /><div><strong>还没有生成任务</strong><span>你的下一帧，从这里开始。</span></div></div>}</section>;
}

export function History({ jobs, select, importJob, loadEarlier, loadingHistory }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [remoteId, setRemoteId] = useState('');
  const [busy, setBusy] = useState(false);
  const visible = jobs.filter(job => (filter === 'all' || (filter === 'completed' ? isSuccess(job.status) : filter === 'active' ? !isDone(job.status) : job.status === 'failed')) && `${job.prompt} ${job.remoteId || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="history-page"><div className="page-heading"><div><h1>任务历史</h1><p>{jobs.length} 个创作任务</p></div><button className="secondary" onClick={() => setImporting(!importing)}><Import size={16} />导入任务</button></div>{importing && <form className="import-form" onSubmit={async e => { e.preventDefault(); setBusy(true); try { if (await importJob(remoteId)) { setImporting(false); setRemoteId(''); } } finally { setBusy(false); } }}><input aria-label="任务 ID" placeholder="粘贴平台任务 ID" required value={remoteId} onChange={e => setRemoteId(e.target.value)} /><button className="primary" disabled={busy}>{busy ? '正在查询…' : '查询并导入'}</button><IconButton title="关闭导入" onClick={() => setImporting(false)}><X size={18} /></IconButton></form>}
    <div className="history-toolbar"><div className="filter-tabs">{[['all', '全部'], ['active', '进行中'], ['completed', '已完成'], ['failed', '失败']].map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="search"><Search size={16} /><input aria-label="搜索任务" placeholder="搜索描述或任务 ID" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
    <div className="history-list">{visible.length ? visible.map(job => <button className="history-row" key={job.id} onClick={() => select(job.id)}><div className="history-icon"><Film size={24} /></div><div className="history-main"><strong>{job.prompt}</strong><span>{MODELS.find(m => m.id === job.model)?.label || '导入任务'} · {job.ratio || '原始比例'} · {time(job.createdAt)}</span><small>{job.remoteId || '尚未取得平台 ID'}</small></div><Status status={job.status} /><ArrowUpRight size={18} /></button>) : <div className="empty-history"><Film size={36} /><h2>{jobs.length ? '没有匹配的任务' : '第一支作品，正在等你'}</h2><p>{jobs.length ? '换个关键词或筛选条件试试。' : '创建视频后，任务会保存在这里。'}</p></div>}</div>{loadEarlier && <button className="secondary" disabled={loadingHistory} onClick={loadEarlier}>{loadingHistory ? '正在加载…' : '加载更早的任务'}</button>}
  </main>;
}
