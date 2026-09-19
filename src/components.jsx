import { useRef, useState } from 'react';
import { X, ImagePlus, Link2, Plus, ArrowUp, ArrowDown, LoaderCircle, CheckCircle2, AlertCircle, Clock3 } from 'lucide-react';
import { fileData, imageSource } from './api';
import { publicUrl, statusLabel } from '../shared/models.mjs';

export function IconButton({ title, children, ...props }) {
  return <button type="button" className="icon-button" title={title} aria-label={title} {...props}>{children}</button>;
}
export function Status({ status }) {
  const good = ['completed', 'succeeded'].includes(status);
  const bad = ['failed', 'unknown'].includes(status);
  const Icon = good ? CheckCircle2 : bad ? AlertCircle : status === 'queued' ? Clock3 : LoaderCircle;
  return <span className={`status ${good ? 'good' : bad ? 'bad' : 'pending'}`}><Icon size={13} />{statusLabel(status)}</span>;
}
export function ReferenceImages({ images, setImages, notify }) {
  const input = useRef(null);
  const [url, setUrl] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  async function addFiles(files) {
    if (!files.length) return;
    setBusy(true);
    try {
      if (images.length + files.length > 9) throw new Error('最多添加 9 张参考图');
      const next = await Promise.all(Array.from(files).map(fileData));
      setImages(current => [...current, ...next].slice(0, 9));
    } catch (error) { notify(error.message, true); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  function addUrl() {
    if (!publicUrl(url.trim())) return notify('请输入有效的 HTTP(S) 图片直链', true);
    if (images.length >= 9) return notify('最多添加 9 张参考图', true);
    setImages(current => [...current, { name: '网络参考图', value: url.trim() }]); setUrl(''); setShowUrl(false);
  }
  function move(index, delta) {
    const next = [...images]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setImages(next);
  }
  return <div className="references">
    <div className="field-heading"><label>参考图片 <span className="muted">{images.length} / 9</span></label><button type="button" className="text-button" onClick={() => setShowUrl(!showUrl)}><Link2 size={13} />添加链接</button></div>
    {images.length > 0 && <div className="image-list">{images.map((item, index) => <div className="reference-item" key={`${item.value.slice(-50)}-${index}`}>
      <img src={imageSource(item.value)} alt={`参考图 ${index + 1}`} /><div className="reference-name"><strong>@图片{index + 1}</strong><small>{item.name}</small></div>
      <IconButton title="上移" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></IconButton>
      <IconButton title="下移" disabled={index === images.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></IconButton>
      <IconButton title={`移除参考图 ${index + 1}`} onClick={() => setImages(images.filter((_, i) => i !== index))}><X size={15} /></IconButton>
    </div>)}</div>}
    {images.length < 9 && <button type="button" disabled={busy} className={`upload ${drag ? 'dragging' : ''}`} onClick={() => input.current.click()} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
      {busy ? <LoaderCircle className="spin" size={22} /> : <ImagePlus size={23} />}<strong>{busy ? '正在处理图片' : '上传参考图片'}</strong><span>PNG / JPG / WebP · 单张 ≤ 10 MB</span>
    </button>}
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={e => addFiles(e.target.files)} />
    {showUrl && <div className="url-input"><input aria-label="参考图片链接" placeholder="https://example.com/image.jpg" value={url} onChange={e => setUrl(e.target.value)} /><IconButton title="添加图片链接" onClick={addUrl}><Plus size={18} /></IconButton></div>}
  </div>;
}
