import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { exportBackup, importBackup } from './api';

export default function BrowserStorage({ notify }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  async function act(work) {
    setBusy(true); try { await work(); } catch (error) { notify(error.message, true); } finally { setBusy(false); }
  }
  return <section className="browser-storage" aria-label="浏览器记录备份"><div><strong>记录保存在此浏览器</strong><p>更换设备、域名或清除网站数据前，请导出备份。备份包含提示词和参考图，不包含视频文件或 API Key。</p></div><div className="backup-actions"><button className="secondary" disabled={busy} onClick={() => act(async () => { const count = await exportBackup(); notify(`已导出 ${count} 条任务记录`); })}><Download size={15} />导出备份</button><button className="secondary" disabled={busy} onClick={() => input.current.click()}><Upload size={15} />恢复备份</button><input ref={input} hidden type="file" accept=".json,application/json" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) act(async () => { const { imported, skipped } = await importBackup(file); notify(`已恢复 ${imported} 条记录，跳过 ${skipped} 条已有记录`); }); }} /></div></section>;
}
