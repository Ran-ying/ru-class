# RU-Class · v0.1

俄语课堂实时字幕。左侧 1/2 预留课堂工作区，右侧显示字幕；录音按钮、时长、延迟和设置位于右侧底部。固定满屏，页面不整体滚动。只实现 v0.1；中文翻译、历史和笔记暂未实现，不保存完整录音。

浏览器 AudioWorklet → 主项目服务端滚动窗口 → 独立 ru-class-asr OpenAI 兼容 API → 常驻 whisper.cpp。本机先在 M1 开发，M4 后期正式验收。旧 Worker 主动连网关方案已被用户修正；当前正常启动不需要 Worker。

## 本地启动

需要 Node.js 22.6+。先按 ru-class-asr README 启动其引擎和 API，再运行：

```sh
npm ci
cp .env.example .env
# 本地填写 ASR_BASE_URL / ASR_API_KEY / ASR_MODEL；key 与 ASR 服务一致
node --env-file=.env --import tsx apps/server/src/index.ts
```

打开 http://localhost:3000，设置中填写或测试语音识别 API 地址（含 /v1）、模型和 key，点击开始并允许麦克风。**本机无需手动输入网关访问令牌**；内部浏览器认证自动建立。API key 由服务端使用，保存的 key 不回传页面。设置只保存到当前服务进程，重启配置放在被忽略的本地 .env。默认只能绑定 loopback；公网登录、HTTPS/WSS 和部署需另行审查授权。本轮未推送或部署。

```sh
ASR_REPO=../ru-class-asr npm test
npm run typecheck
npm run build
# 构建后从仓库根目录启动
node --env-file=.env dist/apps/server/src/index.js
```

## 模块与边界

- apps/web：采集、重采样、设置和字幕；apps/server/src：会话、滚动窗口、调度和兼容 API 客户端。
- 默认 8 秒窗口、1 秒步长、2 秒首次推理；一次推理，其间合并到最新音频，停止识别尾部。只替换最近窗口，不是完整转写归档。
- API 地址含 /v1，服务端调用 /models 和 /audio/transcriptions；远程 API 必须 HTTPS，不跟随重定向。当前 ASR 服务支持俄语 16 kHz 单声道 PCM16 WAV，非完整 OpenAI API 功能集。
- 网络、API、麦克风中断后停止；不支持断网恢复。请另行保留重要课堂录音。
- 模型 key、.env、私人路径、录音、模型和原始日志不能提交。未来多模态和语言模型分别配置，尚未开发。

![当前页面](docs/screenshots/desktop-v0.1.jpg)

[当前架构与 API 合约](docs/api-integration-v0.1.md) · [验收记录](docs/acceptance-v0.1.md) · [后期 M4 流程](docs/hardware-validation.md)。M1 真实短音频 API 联调已通过，不代表 M4 或五分钟自然课堂验收。
