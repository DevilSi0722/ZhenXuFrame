# Vercel 部署：个人 Key 与浏览器存储

1. 将源代码提交到 GitHub，在 Vercel 导入仓库。不要提交 `.local`、真实 `.env` 或 `node_modules`。
2. 框架选择 Vite，构建命令 `npm run build`，输出目录 `dist`，Node.js 22.x 或 24.x。
3. 无需配置环境变量，直接部署。旧的 `FRAME_PASSWORD`、`FRAME_SECRET` 不再使用，可删除。
4. 打开网站直接进入工作台，在「连接设置」填写自己的 DeepKey API Key，点击「保存并测试连接」。

## 密钥保存与传输

- 默认仅保存在当前页面内存，刷新或关闭页面后需重新填写。
- 勾选「在此浏览器记住 API Key」后才写入此域名的 LocalStorage。不跨设备同步，不写入任务 IndexedDB 或备份；浏览器扩展或同源脚本可能访问它，不要在公共设备保存。
- 取消勾选后保存，会移除持久存储但保留当前页面的 Key。「清除 API Key」同时清除当前页面和持久保存的 Key。
- 生成、查询、测试连接时，Key 放在 HTTPS Authorization 请求头，经 Vercel 临时转发到固定的 `https://deepkey.top`。应用不写入服务端文件、数据库、Cookie 或日志，不存入模块级缓存。Vercel 和 DeepKey 在处理请求时会接触 Key；这不是端到端直连。不要添加会记录请求头的第三方日志或监控。
- 旧的 `/api/videos`、`/api/videos/query`、`/api/connection`、`/api/settings`、`/api/login` 和 `/api/logout` 接口已移除。新 `/api/provider/*` 接口必须携带当前访问者的 Key，由 DeepKey 校验有效性，不需要本站登录会话。即使环境变量中仍有 `DEEPKEY_API_KEY`，也不会使用；可在部署后删除旧变量。
- 网站直接进入工作台，不设置登录 Cookie；共享设备请手动清除 Key。任务和备份仍只保存在当前浏览器。

## 转发方式

DeepKey 当前预检响应没有显式允许 Authorization，因此使用本站同源转发，避免浏览器跨域限制。只允许模型列表、创建视频、查询视频三类操作，不允许用户指定任意转发地址。不会自动重试收费请求。

Vercel 函数上限沿用 300 秒配置，创建请求最多等待 DeepKey 受理 180 秒。函数与带宽仍受 Vercel 套餐约束。

## 数据与恢复

任务、提示词、原始参考图存储在当前域名的 IndexedDB；文本草稿保存在 LocalStorage。更换设备、浏览器、域名或清除网站数据前，应在「任务历史」导出备份，再在新地址恢复。备份不包含密钥和视频文件，视频需单独下载。

平台返回任务 ID 前请保持页面打开。提交断线后显示「提交待确认」，先核对平台记录再按 ID 导入，避免重复费用。换 Key 后旧任务暂停查询，恢复原 Key 后继续。旧版本使用相同 Key 与默认 DeepKey 地址时，连接标识保持兼容。

参考图片最多 9 张，单张最多 10 MB；沿用自动压缩，总请求预算 3.8 MB。原始图片保留在浏览器，提交的是压缩副本。平台生成仍按 DeepKey 规则计费。

## 本地模式

`npm run dev` / `npm start` 保持原来的本机文件存储与 Key 设置，不影响已有 `.local` 数据。Vercel 入口 `api/handler.mjs` 使用个人 Key 模式。`npm test` 和 `npm run build` 可验证代码；真实视频生成需部署后用个人 Key 联调。
