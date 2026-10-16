# RU-Class · v0.1.7

面向俄语课堂的实时字幕网页。桌面左右各占 1/2，左侧暂时预留笔记，右侧上方是未来双语历史、下方为实时俄语窗口；开始/停止、时长、延迟与设置在右侧底部。**当前不保存完整录音，也没有正式双语历史、中文翻译。**

当前架构：浏览器 AudioWorklet → 主项目 Node.js 分窗推理 → 独立 `ru-class-asr` 的 OpenAI 兼容 HTTP API → 常驻 whisper.cpp。**旧 Worker 主动连接方案只留作历史/迁移测试，正常启动无需 Worker。**

## 配置与本地启动

需要 Node.js 22.6+。RU-Class **不提供任何默认 ASR、文字或图像 API**，即使维护者自己使用也必须手动配置。若你打算使用自己部署的 `ru-class-asr`，请先单独启动该服务，再在网页中自行输入它的 API 地址、模型和 Token。主项目根目录：

```sh
npm ci
cp config.example.json config.json
# 只设置 listen/site 系统部署参数；首次启动后在网页填写自己的模型 API
npm run dev
```

默认监听 `127.0.0.1:3000`。系统 `config.json` 只包含 `listen` 与 `site` 部署选项，**不存供应商模型或 API Token**。环境变量 `HOST`、`PORT` 等只覆盖部署选项，旧的 `ASR_*` 环境变量在 RU-Class 主项目里不再作为供应商配置使用，因此也不会阻止网页保存。仅限内网单用户测试，网页“模型”设置独立保存在 Git 忽略的 `data/local-models.json`（可通过 `RU_CLASS_LOCAL_MODELS_PATH` 设置路径），且重启后保留。旧部署文件里的 `asr`/`models` 不再自动迁移，请在网页中重新填写。

本地模式的站点访问令牌自动生成。设置标题行现在固定不随内容滚动，左侧标题、中间“模型 / 访问”胶囊、右侧关闭按钮。模型页支持语音、图像、文字三套独立配置，**使用“API 地址 → 获取可用模型 → 下拉选择/空列表手动输入 → 填写 Token → 保存/测试”的逐步流程**。获取模型成功后，原“获取可用模型”按钮和提示隐藏，**模型选择/手动输入框与 Token 输入框立即同时显示**，不再要求额外点击“填写 Token”；下拉小箭头与右侧刷新图标同为 20px。改动地址会清空后续步骤；需要 Token 才能检索的提供者会保留按钮以便填写后重试。保存会持久写入独立的本地用户配置文件，**不自动测试**；测试只验证模型列表接口和模型 ID，不代表图像/文字推理已实现。API 密钥不会回传浏览器。

## 公网与反向代理

**尚未完成面向公众的多用户 BYOK 版，不要直接公开当前单用户内网版本。** 要开放给其他人使用，必须先实现账户鉴权、每用户模型及密钥隔离、会话隔离和 API 请求出口限制，详见 [公共 BYOK 架构及迁移要求](docs/byok-public-service.md)。下面是旧单用户反代模式的历史说明，**不是可公开多人使用的部署指南**。

服务器配置 `site.publicOrigin` 为 **HTTPS 的精确站点来源**，例如 `https://class.example.com`；配置至少 24 字符的 `site.accessToken`，可用 `openssl rand -hex 32` 生成。公网网页在设置中要求手动输入站点令牌（仅保存到当前浏览器标签页），不会返回服务器私有 ASR 密钥；公网模式也不允许在网页中编辑 ASR 配置。建议主项目仍监听 127.0.0.1，通过同机 Nginx 反代并转发 WebSocket 升级。

**完整 Nginx 示例、Mac mini 与 VPS 跨机器连接说明**：[docs/reverse-proxy.md](docs/reverse-proxy.md)。不要把未受保护的 HTTP 后端端口直接开放到互联网，也不要将示例 Token 作为真实密码使用。

## 质量检查

```sh
ASR_REPO=../ru-class-asr npm test
npm run typecheck
npm run build
node dist/apps/server/src/index.js
```

v0.1.1 修复：正常停止录音时保留最后字幕；独立 ASR API 临时返回 HTTP 429 时有限重试；两个 Node 服务都能从忽略提交的 JSON 文件加载监听端口。未进行新的真实设备验证前，修复后的部署验收仍待执行。

当前 ASR **音频**窗口最多 8 秒，约 1 秒步长；v0.1.2 新增不随该窗口滚动而消失的 **稳定文字累计缓冲**，并用可改写的临时尾部显示最新俄语。已确认文字不受音频窗口截断，停止后保留当前课程全部可见文字。此机制基于重叠词序列的启发式共识，还不是 v0.3 的精细时间戳/词级对齐。具体说明见 [docs/transcript-v0.1.2.md](docs/transcript-v0.1.2.md)。联网失败、麦克风中断都会停止当前录音，v0.1 不支持断网续录，因此不要将它作为重要课堂录音的唯一副本。

[当前 ASR API 协议](docs/api-integration-v0.1.md) · [原始 v0.1 验收记录](docs/acceptance-v0.1.md) · [后续 M4 验收](docs/hardware-validation.md)。此前 M1 短音频真实 API 联调通过，未声称 M4 完整验收。

**v0.1.3：** 停止录音后隐藏无用状态文字，保留俄语转写；对齐机制要求近期 Whisper 窗口之间有可信重叠，不用历史术语误吞新句。详见 [docs/v0.1.3-notes.md](docs/v0.1.3-notes.md)、[docs/v0.1.4-notes.md](docs/v0.1.4-notes.md) 与 [docs/v0.1.5-notes.md](docs/v0.1.5-notes.md)、[docs/v0.1.6-notes.md](docs/v0.1.6-notes.md)。
