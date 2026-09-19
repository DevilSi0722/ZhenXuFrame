import { useEffect, useState } from 'react';
import { Type, Images, Sparkles, WandSparkles, ChevronDown, Monitor, Smartphone, Square, ArrowUpRight } from 'lucide-react';
import { MODELS, RATIOS } from '../shared/models.mjs';
import { ReferenceImages } from './components';
import { saveDraft } from './api';

export const DEFAULT_DRAFT = { model: MODELS[0].id, prompt: '', aspect_ratio: '16:9', seconds: 8, mode: 'image', images: [], videoUrls: '', audioUrls: '' };
export const SAMPLE_PROMPT = '清晨，阳光穿过山谷，洒在平静的翡翠色湖面上。一艘木船轻轻漂动，远山薄雾缓慢流动。镜头从湖边低机位缓缓向前推进，水面泛起细小涟漪。电影质感，自然光线，运镜平稳，无字幕。';

export default function Composer({ draft, setDraft, submit, submitting, configured, openSettings, notify }) {
  const [advanced, setAdvanced] = useState(false);
  const model = MODELS.find(m => m.id === draft.model) || MODELS[0];
  const seconds = model.seconds || draft.seconds;
  const update = patch => setDraft(current => ({ ...current, ...patch }));
  useEffect(() => { const id = setTimeout(() => saveDraft(draft), 350); return () => clearTimeout(id); }, [draft]);
  const setImages = value => setDraft(current => ({ ...current, images: typeof value === 'function' ? value(current.images) : value }));
  return <section className="composer" aria-label="视频生成配置">
    <div className="composer-heading"><h1>视频创作</h1><span className="version-label">SEEDANCE 2.0</span></div>
    <div className="segmented modes">{[['text', Type, '文字生视频'], ['image', Images, '参考图生视频']].map(([value, Icon, label]) => <button type="button" key={value} aria-pressed={draft.mode === value} className={draft.mode === value ? 'active' : ''} onClick={() => update({ mode: value })}><Icon size={16} />{label}</button>)}</div>
    <form onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="field-heading"><label htmlFor="prompt">画面描述</label><button className="text-button violet" type="button" onClick={() => update({ prompt: SAMPLE_PROMPT })}><WandSparkles size={13} />灵感示例</button></div>
      <div className="prompt-wrap"><textarea id="prompt" required value={draft.prompt} onChange={e => update({ prompt: e.target.value })} placeholder={draft.mode === 'image' ? '描述画面、动作与镜头变化…\n\n可用 @图片1 引用对应素材。' : '描述你想拍摄的画面…\n\n主体、场景、动作、运镜与光线。'} /><div className="prompt-bottom"><span>中文 / English</span><span>{draft.prompt.length} 字</span></div></div>
      {draft.mode === 'image' && <ReferenceImages images={draft.images} setImages={setImages} notify={notify} />}
      <div className="field-heading"><label htmlFor="model">生成模型</label><span className="muted">720p</span></div>
      <select id="model" value={draft.model} onChange={e => update({ model: e.target.value })}>{MODELS.map(m => <option key={m.id} value={m.id}>Seedance 2.0 {m.label}</option>)}</select>
      <div className="model-meta"><span>{model.seconds ? '固定时长 · 按次计费' : '灵活时长 · 按秒计费'}</span><span>¥{model.seconds ? (model.rate * model.seconds).toFixed(2) + ' / 次' : model.rate.toFixed(2) + ' / 秒'}</span></div>
      <div className="field-heading"><label>画面比例</label></div>
      <div className="ratio-grid">{RATIOS.map(ratio => { const [w, h] = ratio.split(':').map(Number); const Icon = w === h ? Square : w > h ? Monitor : Smartphone; return <button type="button" aria-pressed={draft.aspect_ratio === ratio} className={draft.aspect_ratio === ratio ? 'selected' : ''} onClick={() => update({ aspect_ratio: ratio })} key={ratio}><Icon size={17} /><span>{ratio}</span></button>; })}</div>
      <div className="two-fields"><div><label htmlFor="duration">视频时长</label><select id="duration" value={seconds} disabled={!!model.seconds} onChange={e => update({ seconds: Number(e.target.value) })}>{Array.from({ length: 11 }, (_, i) => i + 5).map(s => <option key={s} value={s}>{s} 秒</option>)}</select></div><div><label htmlFor="resolution">分辨率</label><input id="resolution" value="720p HD" readOnly /></div></div>
      <div className="advanced"><button type="button" className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><span>视频与音频参考</span><ChevronDown className={advanced ? 'rotated' : ''} size={16} /></button>{advanced && <div className="advanced-content"><label htmlFor="video-urls">视频直链 · 最多 3 段，每段 ≤ 15 秒</label><textarea id="video-urls" value={draft.videoUrls} onChange={e => update({ videoUrls: e.target.value })} placeholder="每行一个 https:// 地址" /><label htmlFor="audio-urls">音频直链 · 最多 3 段，每段 ≤ 15 秒</label><textarea id="audio-urls" value={draft.audioUrls} onChange={e => update({ audioUrls: e.target.value })} placeholder="每行一个 https:// 地址" /></div>}</div>
      <div className="generate-area"><div className="estimate"><span>预计费用</span><strong>¥{(seconds * model.rate).toFixed(2)} <small>/ {seconds} 秒</small></strong></div><button className="primary generate" type={configured ? 'submit' : 'button'} disabled={submitting} onClick={!configured ? openSettings : undefined}><Sparkles size={18} />{submitting ? '正在提交任务…' : configured ? '生成视频' : '配置 API 连接'}<ArrowUpRight size={18} /></button><p className="price-note">标准价参考 · 实际费用以平台账单为准</p></div>
    </form>
  </section>;
}
