# 帧序 FRAME

Seedance 视频工作台，基于 [DeepKey 视频教程](https://doc.deepkey.top/#guide-seedance-video)，支持中文提示词和参考图生成视频。

**Vercel 个人 Key 版**：每位使用者自行填写 DeepKey API Key，可选择保存在自己的浏览器。请求时 Key 临时经过 Vercel 转发给 DeepKey，应用不在服务器保存 Key。任务和参考图保存在 IndexedDB，支持备份恢复。Vercel 只需配置工作台密码，不需要 Redis、Blob 或共享 API Key。步骤见 [Vercel 部署指南](DEPLOY_VERCEL.md)。以下章节说明原有本地模式。

## 启动

需要 Node.js 22 或更新版本。

```powershell
npm install
npm run dev
```

打开终端显示的地址，默认 http://127.0.0.1:3100 。端口占用时自动尝试 3101–3120。

生产模式：

```powershell
npm run build
npm start
```

## 使用

1. 在「连接设置」填写 DeepKey API 根地址和 seedance 分组的 API Key，点击「保存并测试连接」。若本机已配置 `DEEPKEY_API_KEY` 或 `~/.config/deepkey/credentials.env`，会自动使用该凭据，但是否有视频权限以连接测试为准。
2. 选择文字或参考图模式。图片支持 PNG/JPEG/WebP 文件、拖放和公网直链，最多 9 张。单图本地限制 10 MB，请求总限制 100 MB。上传不会压缩参考图，支持 4K 图片。
3. 在提示词中用 `@图片1` 等标签引用素材，可调整顺序。参考视频和音频支持各 3 个公网直链，每段不超过 15 秒。当前不提供音视频上传或时长探测，素材时长由用户确认，最终由平台校验。
4. 选择 Mini/Fast、固定 10/15 秒或 5–15 秒自定义档，配置画幅。固定 720p，标准费用预估以 2026-09-17 文档为准，实际以控制台账单为准。
5. 点击生成，任务每 10 秒由后端查询，浏览器每 4 秒读取本地状态。网络错误会保留任务并延后查询。关闭网页不影响正在运行的后端；重启后端后恢复已知任务查询。
6. 完成后播放或下载 MP4。任务历史支持搜索、状态筛选、参数复用以及按任务 ID 导入。平台没有开放任务列表接口，因此只显示本地记录和手动导入的任务。

## 数据与密钥

- `.local/settings.json` 保存手动输入的密钥（本机明文文件），`.local/jobs.json` 保存任务、生成参数和参考图。该目录已列入 `.gitignore`。请勿将其公开或分享。
- 密钥不返回前端，不进入浏览器 LocalStorage。LocalStorage 仅保存表单文本草稿，未提交的图片不跨刷新保存；已提交图片可从历史任务复用。
- 应用监听 `127.0.0.1`，并限制 Host 和跨站请求，适用于单用户本机。不要直接暴露公网；公网部署需要增加用户认证、独立数据隔离、密钥加密和请求限流。
- 改用其他地址或密钥后，旧任务会暂停查询并提示恢复原连接，防止跨账户查询。
- 提交请求不会自动重试。提交超时、非明确拒绝或缺少任务 ID 时，记录为「提交待确认」，应先核对平台记录再导入任务 ID，避免重复费用。
- 下载链接为平台临时存储，应及时保存到本机。

## 实现与验证

React + Vite + Express；后端根据教程向 `/v1/videos`、`/v1/videos/{id}` 和 `/v1/models` 请求，支持响应 ID/URL/status 别名。前端为中文三栏工作台和自适应移动布局。

```powershell
npm test
npm run build
```

`PORT` 可覆盖端口，`FRAME_DATA_DIR` 可隔离测试数据。视觉素材 `public/generated/lake.png` 为 AI 生成的灵感参考图片，不是模型输出的视频。

## 品牌图标与 Safari

Logo 使用翡翠绿底、白色 F 与浅绿播放符号，源文件为 `public/logo.svg`，1024px 导出为 `public/logo-1024.png`。网页侧栏和登录页使用同一图形。

- 标签栏：SVG、16/32px PNG，以及包含 16/32/48px 的 `favicon.ico`。
- iPhone / iPad 主屏幕：180/167/152px 不透明方形 PNG，保留系统圆角裁切；默认根目录文件为 `apple-touch-icon.png`。
- Safari 固定标签：单层纯黑、透明背景、`viewBox="0 0 16 16"` 的 `safari-pinned-tab.svg`，通过 `mask-icon` 指定品牌色。
- Web App Manifest：提供 192/512px 图标及主屏幕名称「帧序」。不提供离线生成功能。

图标已在 `index.html` 显式声明，部署时无需额外配置。运行 `npm run icons` 可从 `scripts/generate-icons.mjs` 重新导出全部尺寸，再运行 `npm run build`。Apple 规范参考：[Web Clip 图标](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)、[Safari 固定标签](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/pinnedTabs/pinnedTabs.html)。Safari 可能缓存旧图标，部署后可重新打开页面；已有主屏幕快捷方式必要时移除后重新添加。当前在 Windows 验证了文件规格、资源可访问性和浏览器声明，未在 Safari 真机上验证。
