# 浏览器直连 BYOK · 当前权威设计（v0.4.0；v0.2.0 起采用该架构）

## 用户确定的最终产品原则

- **公共网页**，任何人直接访问，无登录/注册、不创建服务器用户资料、不要求全站访问令牌。
- **没有默认 API**：每个用户自己填写语音、图像、文字 API 地址、模型 ID 与 Token。维护者与普通用户使用同一套网页。
- **所有用户资料留在访问者自己的浏览器**：模型/Token、课堂录音、课程名称、识别文字；不提供后台数据库、跨设备自动同步或站点账户。
- **浏览器直连第三方 API**：请求从用户自己的浏览器直接发送给用户选择的服务商，服务端只提供 HTML/CSS/JS 静态页面。不支持 CORS 的 API **直接视为不兼容，不实现任何服务器转发或 CORS 代理**。
- 没有服务器 AI 计算资源和公共 AI Key，也没有用户共用的 Whisper 或 DeepSeek 接口。

## 架构与模块

```
Static HTTPS website (RU-Class)
         |
         +-- browser IndexedDB: own profiles / transcripts / PCM chunks
         |
         +-- browser microphone -> AudioWorklet -> 16kHz Float32 chunks
                                     |             |
                                     |             +-- IndexedDB PCM16 WAV chunks
                                     |
                                     +-- 8s AudioRing (memory only)
                                            |
                                     1s serial browser fetch
                                            |
                            user-selected CORS-enabled HTTPS ASR API
                                            |
                                     rolling window hypotheses
                                            |
                           browser TranscriptBuffer (stable + draft)
                                            |
                                browser-local RU transcript
```

**文件**：`apps/web/app.js`（UI、采集和本地资料）；`apps/web/direct-asr.js`（环形窗口、WAV、请求、重试）；`apps/web/transcript.js`（v0.1.3 文字共识算法从 TypeScript 移植到可运行的浏览器 JS）；`apps/web/local-store.js`（IndexedDB 模型/课堂/录音）；`apps/server/src/site.ts`（仅用于可选 Node 静态页面服务）。

Node 启动入口改为 `createSite`，不注册 `/api/*` 或 `/ws/client`。旧 Node `gateway.ts`、`session.ts` 和部分回归测试保留为历史参考，但不再进入实际用户录音链路。公网可以直接用 Nginx/CDN 静态托管 `apps/web` 文件。

## API 使用规则

模型配置（v0.2.1）：最初同时展示 API 地址与可选 API Token，下面展示“获取可用模型”；用户填写 Token 后可以直接检索，无需先触发 401。点击获取后显示模型下拉框，接口明确不支持模型列表时显示手动输入；修改 API 地址或 Token 均会清除旧模型选项并要求重新获取。保存配置与测试连接保留独立操作。\n\n模型检索：`GET {baseUrl}/models`，仅渲染 API 实际返回的模型 ID；明确不支持列表时允许手动输入。需要 Token 才能列出模型的 API 在 401/403 时先展示 Token，再重试。正常的保存操作只写浏览器 IndexedDB，不联网；测试连接单独请求 API。音频转写：`POST {baseUrl}/audio/transcriptions`，multipart 包含 WAV / model / language=ru / response_format=json。

请求仅支持 HTTPS，或浏览器本机 loopback 的 HTTP；始终拒绝跳转和有 URL 用户密码的地址。不能从网页绕过 CORS。CORS 失败和网络失败在浏览器中可能显示为相同的 `TypeError`，UI 只提醒用户检验 CORS、连通性及 TLS，不假称能够精确区分。

用户自己的 ASR 主机如果位于其他设备，需在浏览器可访问的 HTTPS 域名开放兼容 API，并在该 ASR 服务的 `cors.allowedOrigins` 列出实际 RU-Class 网站域名。不能把自建 Mac 的 localhost URL 填入其他设备上的浏览器并期待连到 Mac。

## 录音和文字稳定化

- AudioWorklet 进行 16kHz 重采样，每约 200ms 提交 PCM 数据块；内存 Ring 保留最近 8 秒。
- 2 秒左右启动第一次识别，以后最多每秒 1 次，**严格串行请求**；429 允许有限退避重试。当前没有词级时间戳；沿用 v0.1.3 LocalAgreement 风格稳定化，不能保证每个重复词的 100% 准确。
- 停止：先 flush worklet，等待已在途推理，处理最后音频窗口或结算尾部，保存当前课堂的文字与完整 PCM16 音频分块。浏览器提供 WAV 下载，不把录音上传给 RU-Class 网站。
- `IndexedDB` 存储易受配额、无痕、数据清理或系统回收影响。课堂数据只有在浏览器写入成功后才算保留，应定期自行下载文件。离线 ASR、后台录音、云同步均不在本版范围。
- **v0.4.0 已实现文字模型安全消费**：仅向用户自选 `/chat/completions` 提供商发送已稳定、在确认窗口结束后经过至少 8 秒（或正常停止 final flush）的完整来源单元；接受回复前验证精确前缀，先持久化 RU/ZH 句子再确认消费。支持按录音手动恢复未翻译单元，不自动产生付费重试。词级时间戳与下方实时中文仍未实现。

## 隐私和安全

网站的静态 JS 在浏览器内运行并可读取 IndexedDB，因此 Token **不是硬件级加密或隔离存储**。应采用可信 HTTPS 主站、不嵌入第三方脚本、限制 CSP、优先使用提供商提供的可撤销/限额短期 Token。用户选择的语音 API 会收到音频；配置文字模型后，稳定俄语还会发送给文字 API，可能产生费用。图像推理尚未实现。请用户自行阅读提供商政策。

**永远不要将用户 Token 通过 RU-Class `/api`、日志、全局服务器配置、URL query 参数或网站运营者自己的共享 API 发送。** 用户自行清空网站数据可同时删除本地 Token 和课堂资料；未来若添加导出，请分别考虑 Token 的包含范围。

## CI 与实机差异

`npm test`、`npm run typecheck`、`npm run build` 验证浏览器核心模块与静态站点；实际跨域 CORS、Safari 音频、内存和 IndexedDB 在 Mac/iPad 上仍要真实验收。独立 `ru-class-asr` 的 Origin 白名单及 `OPTIONS` 测试在自己的仓库执行。

## 迁移和兼容性

v0.1.7 以前 RU-Class 网关持有 ASR 地址/Key、经 WebSocket 接收音频。v0.2.0 完全改变这一协议，已运行的老版服务需要更新整个网站 JS 和 Node 启动入口。以前的服务端 `config.json`、`data/local-models.json` 和 `ASR_*` 中的模型密钥**不会自动转移到浏览器**，需要用户自行在网页重新填写；确认迁移后应删除旧文件中不用的长期密钥。独立 `ru-class-asr` 的配置仍属于用户自己部署的 ASR 服务，不能误删。
