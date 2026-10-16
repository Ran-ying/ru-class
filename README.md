# RU-Class · v0.1.4

面向俄语课堂的实时字幕网页。桌面左右各占 1/2，左侧暂时预留笔记，右侧上方是未来双语历史、下方为实时俄语窗口；开始/停止、时长、延迟与设置在右侧底部。**当前不保存完整录音，也没有正式双语历史、中文翻译。**

当前架构：浏览器 AudioWorklet → 主项目 Node.js 分窗推理 → 独立 `ru-class-asr` 的 OpenAI 兼容 HTTP API → 常驻 whisper.cpp。**旧 Worker 主动连接方案只留作历史/迁移测试，正常启动无需 Worker。**

## 配置与本地启动

需要 Node.js 22.6+。先启动独立 ASR 服务。主项目根目录：

```sh
npm ci
cp config.example.json config.json
# 将 asr.apiKey 改为独立 ASR 服务的 API Key
npm run dev
```

默认监听 `127.0.0.1:3000`。在 `config.json` 的 `listen.host` 和 `listen.port` 自由配置地址与端口。文件位于项目根目录，**不会提交到 Git**。可用 `RU_CLASS_CONFIG` 指定其他位置。环境变量 `HOST`、`PORT`、`ASR_BASE_URL`、`ASR_MODEL`、`ASR_API_KEY` 可覆盖相应项；旧 `.env` / `node --env-file=.env` 方式仍然可用。

本地模式的站点访问令牌自动生成。设置标题行现在固定不随内容滚动，左侧标题、中间“模型 / 访问”胶囊、右侧关闭按钮。模型页支持语音、图像、文字三套独立配置，**可按当前 API 地址和 Key 获取 /models 列表并从下拉框选择模型**；无法获取时可手动输入模型 ID。保存会持久写入私有 config.json，**不自动测试**；测试只验证模型列表接口和模型 ID，不代表图像/文字推理已实现。API 密钥不会回传浏览器。

## 公网与反向代理

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

**v0.1.3：** 停止录音后隐藏无用状态文字，保留俄语转写；对齐机制要求近期 Whisper 窗口之间有可信重叠，不用历史术语误吞新句。详见 [docs/v0.1.3-notes.md](docs/v0.1.3-notes.md) 和 [docs/v0.1.4-notes.md](docs/v0.1.4-notes.md)。
