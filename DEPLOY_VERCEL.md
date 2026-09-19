# 部署到 Vercel

当前代码同时支持原有本地模式与 Vercel 私人云端模式。无需运行远程服务器，也无需配置定时任务。

## 1. GitHub 仓库

把项目源代码上传到你的 GitHub 仓库（建议私人仓库），不要上传 `.local`、`.env*`、`node_modules`、`dist`、`.vercel`。这些路径已在 `.gitignore` 排除，只有无真实密钥的 `.env.example` 可以提交。

本机历史和密钥不会自动迁移到云端。原有 `.local` 数据仍保留；需要查看旧视频时，在云端「任务历史 → 导入任务」粘贴平台任务 ID，并使用原来的 DeepKey Key。导入不产生新生成费用，但无法恢复旧任务的参考图和提示词参数。

## 2. 导入 Vercel

在 Vercel 选择 Add New → Project → 导入 GitHub 仓库。框架选择 **Vite**，根目录为本项目目录，构建命令 `npm run build`，输出目录 `dist`，Node.js 选择 **22.x 或 24.x**。

项目内 `vercel.json` 已配置 API 路由和 300 秒函数上限。启用 **Fluid Compute**；确认账户允许 300 秒函数时间。后台提交通过 Vercel `waitUntil` 完成，平台受理后不再占用函数等待生成。

## 3. 连接两个存储

在项目 Storage / Marketplace 中创建并连接：

| 服务 | 用途 | 环境变量 |
| --- | --- | --- |
| Upstash Redis | 任务、提交去重、加密配置、登录限流 | `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`，或集成生成的 `KV_REST_API_URL`、`KV_REST_API_TOKEN` |
| Vercel Blob，必须选择 **Private** | 参考图片 | `BLOB_READ_WRITE_TOKEN` |

参考图从浏览器直传 Blob，支持单图 10 MB、最多 9 张，不压缩图片，不经过函数请求体。后端会读取私有图片并以 base64 提交给 DeepKey，DeepKey 不需要访问你的 Vercel 登录页面。缩略图通过登录后的流式接口读取。

## 4. 配置环境变量

进入 Settings → Environment Variables：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `FRAME_PASSWORD` | 是 | 工作台登录密码，使用至少 16 位随机密码 |
| `FRAME_SECRET` | 是 | 至少 32 位随机字符串，用于会话签名与 API Key 加密；必须妥善保留 |
| 上面的 Redis / Blob 变量 | 是 | 连接存储后自动生成或手动填写 |
| `DEEPKEY_API_KEY` | 否 | 可在这里配置，也可部署后登录「连接设置」输入 |
| `DEEPKEY_BASE_URL` | 否 | 默认为 `https://deepkey.top`；必须为 HTTPS 根地址 |
| `FRAME_NAMESPACE` | 否 | 默认为 `frame:v1`；建议生产环境 `frame:production:v1` |

可在自己终端用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` 生成随机值，密码和加密密钥各生成一次。不要给这些变量加 `VITE_` 前缀，不要写入 GitHub 源代码。

更换 `FRAME_PASSWORD` 会使现有登录会话失效。更换 `FRAME_SECRET` 也会导致已保存的 API Key 无法解密；届时在登录后的设置页重新保存 Key 或点击「使用部署环境凭据」。

Production 和 Preview 请使用独立的 Redis/Blob、密码和加密密钥。至少使用不同 `FRAME_NAMESPACE`，防止预览版本修改正式任务。不要向不可信分支提供生产凭据。

## 5. 重新部署与使用

连接存储、设置变量后执行 Redeploy。打开分配的域名，输入工作台密码，在连接设置中测试 DeepKey。建议先用一个任务验证文字生成，再验证参考图生成（实际生成会计费）。

检查参考图能上传和显示、提交后出现任务卡片、刷新网页仍能看到任务、完成后可播放和下载。绑定自定义域名不需要改代码，API 会限制为同源请求。

## 运行行为与边界

- 私人单用户工作台，不提供多用户数据隔离。登录有效期七天，登录尝试与图片上传有服务端限流。
- 提交请求先用 Redis 原子事务保存任务与去重标识，再立即返回 `202`。后台最多等待 DeepKey 受理 180 秒；不会自动重提收费请求。Vercel 中断后台执行时，超过五分钟仍未确认的任务会显示「提交待确认」，应先核对 DeepKey 记录再导入 ID。
- 关闭网页后，DeepKey 已受理的视频继续生成。网页可见时每 15 秒同步一批最多五个任务，重新打开后恢复同步；不使用常驻进程或 Cron。大量并行任务可能需要多个同步周期。
- 每次加载 100 条历史，支持加载更早的记录。历史搜索针对已加载记录。
- API Key 使用 AES-256-GCM 加密保存到 Redis，真实密钥不返回浏览器。任务参数和提示词存储在 Redis，参考图在私有 Blob。
- 图片上传后会保留，移除表单里的图片不会删除 Blob；可以在 Vercel Storage 管理未使用图片。删除仍被任务引用的图片会使参数复用失效。存储、函数和网络流量受各服务套餐额度与费用约束。
- 视频播放/下载直连 DeepKey 提供的地址，不持久归档视频，链接可能过期。下载可能在浏览器中打开视频，此时可使用播放器的下载/另存为。
- 本次仅完成代码和模拟测试；真实 Vercel 路由、Redis、Private Blob 直传、平台实际生成需部署后联调。

## 本地运行

`npm run dev` 或 `npm run build` 后 `npm start` 仍使用原有文件存储与本机凭据，不需要 Redis/Blob。`.env.example` 是部署配置参考，本地模式不自动加载它。

运行 `npm test` 和 `npm run build` 可检查后端行为及前端构建。测试使用模拟平台与隔离内存存储，不读取 `.local` 或请求真实 DeepKey。
