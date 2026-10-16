# RU-Class — 项目总任务书与分版本开发计划

> 文档版本：规划稿 1.5 · 2026-10-16（v0.1.3 对齐加强与独立模型设置）  
> 状态：**产品与技术方案；不是已开发/已测试的功能清单**  
> 本文件作为 Codex 的长期实施依据，放入 `ru-class` 主仓库根目录，建议提交名 `PROJECT_SPEC.md`。  
> **当前已批准 v0.1.3 对齐及设置改进；v0.2 及以后仍需用户逐版批准。**

## 当前架构与变更优先级（2026-10-16）

**本节覆盖下方较早的 v0.1 设计草案。** 用户在开发中明确修改默认拓扑：`ru-class-asr` 是一个可以单独运行的、带 API Key 的 OpenAI 兼容 HTTP ASR 服务（`/v1/models` 和 `/v1/audio/transcriptions`），它调用本地常驻 whisper.cpp。主项目 `ru-class` 负责浏览器 WebSocket 音频接收、窗口调度，通过服务端配置的 Base URL、模型和 API Key 调用该独立 ASR API。旧的 Mac Worker 主动连接 VPS 方案只保留历史/迁移测试用途，不再作为默认入口。

当前**桌面左右 1:1**，录音/时长/延迟/设置工具条位于**右侧底部**，左侧笔记区只预留；M1 为现阶段开发实测硬件，M4 的正式硬件验收推迟。v0.1.1 修复包含：正常停止后保留最后俄语字幕、遇独立 ASR API 暂时返回 429 时进行有限退避重试、**两仓库支持私有 `config.json` 配置监听地址与端口**。主项目可置于 HTTPS/WSS 公网反代后，必须设置精确 `site.publicOrigin` 和强站点访问令牌；网站令牌与服务端独立 ASR API Key 分离，公网拒绝本地 bootstrap 令牌及浏览器 API 设置变更。

v0.1.2 补充约束：由于原始 8 秒 Whisper 音频窗口会持续滚动，必须在主项目服务端维护另一个不随音频窗口滚动的文字缓冲，拆分为 append-only `stable_unconsumed` 与可被下一次识别更新的 `partial`；仅提交增量稳定文字、替换临时尾部。v0.1.2 **不消费稳定文字、不调用 DeepSeek、不写持久档案**；只提前实现 v0.3 中的一部分稳态机制，后续 v0.3 仍需时间戳与更精细的对齐。见 `docs/transcript-v0.1.2.md`。

v0.1.3：正常停止后不显示“已停止 · 尾部识别完成”或“等待语音识别 API”，但保留俄语字幕；文字对齐只接受与邻近音频窗口形成可信锚点的匹配，防止新句重复旧术语而被吞掉。设置顶部为“模型 / 访问”胶囊式选项卡，模型页提供语音/图像/文字三组独立 API 地址、模型名和密钥，**保存配置**与**测试连接**必须分开；本地保存持久写入私有 config.json，测试仅验证兼容 /models 接口，不代表图像或文字推理已实现。参见 docs/v0.1.3-notes.md。

当前权威部署说明：`docs/api-integration-v0.1.md`、`docs/reverse-proxy.md`、`docs/transcript-v0.1.2.md` 和两仓库 README。下文出现的“左 2/3 / 右 1/3”“Worker 主动连接”“M4 是立即开发前提”等早期描述一律按本节覆盖。后续版本以当前实际接口为基础，不因阅读旧任务书而恢复旧设计。

## 0. 项目定位与工作边界

开发一款以俄语大学课堂为场景的网页版实时语音转写与翻译系统。学生在浏览器中开始录音后，底部实时显示俄语字幕与中文临时译文；右侧上部逐句累加经必要校正的俄语及对应中文，句子与完整原始录音关联，可逐句回放。未来左侧笔记区可以接 AI 自动整理，但 **当前只开发右侧 1/3 转写系统，左侧 2/3 只预留空间**。

- 产品定位：课堂长期记录与学习辅助，不是音频聊天机器人，也不要求学生手写笔记。
- 产品端采用 Web/PWA 标准架构，原则上可在 iPad Safari 和其他现代浏览器使用。**项目作者只需在自己具备的 iPad、Mac mini/macOS 等设备上进行真实验收；Windows、Linux、Android 等其他平台不列为项目作者必须覆盖的测试环境。**
- 不开发原生 iOS App，不购买 Apple Developer Program，不在客户端运行 Whisper 或 LLM。
- 技术栈：浏览器 JavaScript/TypeScript；网页与应用后端跨平台 Node.js/TypeScript；ASR Worker 采用**跨平台 Node.js/TypeScript 核心**，底层由原生 `whisper.cpp` 推理（允许 C++ 进程，不引入 Python 应用服务器）。**Mac mini M4 + macOS + Metal 是 v0.1 的首个部署和验收环境，不是 ASR 的架构边界。**
- AI：第一目标在 Mac mini M4 16GB 运行本地多语言 Whisper（Metal 加速）；架构保留 Linux/Windows 等环境运行等价 ASR Worker 的可能性，但不要求项目作者部署或验证；DeepSeek 官方 `deepseek-flash` 用于正式断句、俄语校正、中文翻译；底部实时中文翻译服务**尚未选型**，只设计可替换接口。
- 本对话负责头脑风暴、方案、验收和后续任务书；开发交给 Codex。**未经用户明确指令，不主动创建仓库、改代码、部署、升级服务或合并 PR。**
- 以前生成的 v0.1 实验原型不视为正式基线或验收依据；Codex 可以只读参考，但应按本文重新设计。

## 1. 仓库组织与命名

### 建议仓库名

1. **`ru-class`（保留）**：主产品。负责 Web/PWA、Node.js 应用服务器、课程管理、前端、实时双语缓冲与历史、未来本地持久化/导入导出、DeepSeek/翻译服务接入、协议与任务书。
2. **`ru-class-asr`（推荐替代 `whisper-stream`）**：可部署于 macOS、Linux、Windows 的跨平台 Whisper Node.js Worker，及其 `whisper.cpp` 适配层、音频窗口调度、转写输出、性能测试；**第一版只要求在 Mac mini M4 跑通。** `whisper-stream` 名称也可用，但已是 whisper.cpp 官方示例命令名并与多个 GitHub 项目重名，搜索、安装和定位代码时易混淆。若用户最终决定仍用 `whisper-stream`，仅替换仓库路径，技术设计不变。

两仓库应独立版本管理和部署；不复制整个 `whisper.cpp` 第三方仓库，使用明确的依赖/编译安装方法。跨仓库协议在主仓库文档中固定版本，并在 ASR 仓库维护相同版本的说明和契约测试。未来可共享一个轻量 TypeScript 类型包，**v0.1 不必为了共享类型引入第三仓库**。

建议主仓库：

```text
ru-class/
  PROJECT_SPEC.md       # 本文件
  README.md
  docs/protocol.md
  docs/decisions.md
  apps/web/             # 浏览器前端
  apps/server/          # Node.js 网关与业务服务器
  tests/
```

建议 ASR 仓库：

```text
ru-class-asr/
  README.md
  docs/protocol.md
  src/                  # Node.js worker 与推理适配器
  scripts/              # 优先提供 macOS 安装/运行脚本；其他平台脚本可由社区贡献
  tests/
```

目录只是建议，可在 v0.1 首次提交时简化；不要为未来功能过度造框架。

### 1.1 跨平台设计约束（从 v0.1 开始遵循，但不要求逐平台开发或验收）

- `ru-class`：前端采用标准 Web API，服务端使用跨平台 Node.js。核心业务不能依赖 macOS 专属工具、硬编码绝对路径或 Darwin 环境变量。PWA 和浏览器音频 API 的兼容性需实际验证，**跨平台设计不等于已完成跨平台验收**。
- `ru-class-asr`：将**跨平台的音频输入、缓冲与稳定化、时间戳、Worker 通信和协议层**与**平台特定的 whisper.cpp 启动/安装/加速配置**隔离；应用层只依赖统一的推理适配器，不直接引用 Metal/CUDA API。
- 推理后端：macOS Apple Silicon 优先 Metal；支持的平台/构建可选择 CPU、NVIDIA CUDA、Vulkan 等；**可用性由 whisper.cpp 构建、驱动和设备决定**，不承诺在所有 GPU 上自动加速。预留 `backend=auto|metal|cuda|vulkan|cpu` 或等价配置，但 v0.1 可以只实现 `auto`（Mac 自动选本机可用配置）和必要的 CPU 后备，不必做空壳驱动矩阵。
- 跨平台进程管理使用 Node.js `child_process` 等可移植接口；把可执行文件位置、模型路径、推理端口、启动参数做成配置，不写死 `/opt/`、`/usr/local/`、Homebrew 路径或 `.exe` 假设。平台专属的安装/启动脚本独立放置，不渗透 ASR 核心代码。
- Worker → VPS 的消息格式、状态上报、音频时间轴语义在 macOS、Linux、Windows 上保持相同；浏览器和 VPS 不得根据 Worker 系统类型修改业务逻辑。
- **交付策略：仅要求在 Mac mini M4/macOS/Metal 以及作者实际使用的浏览器环境完成验收。** Windows/Linux 等其他环境属于“架构兼容目标、未经作者实测”；不设置开发或验证里程碑，不以其通过测试作为 v1.0 发布条件。其他使用者可自行尝试部署、提交 Issue、日志、复现步骤与 PR；维护者可酌情接受修复，但不承诺负责适配、排障或购买其他平台硬件。

### 1.2 社区部署与反馈原则

- 保留平台无关的核心代码、参数化推理引擎路径和标准协议；不为作者没有的设备安排强制性的跨平台功能开发、安装包制作或真实硬件测试。
- README 按事实写明 **作者实测**、**社区反馈已运行**、**尚未验证** 三种情况；社区反馈不等同于作者亲自验证，也不能据此保证兼容性。
- 其他使用者可以 fork/clone 仓库，按通用文档和自己的 whisper.cpp 构建在 Windows/Linux 等环境尝试；遇到问题请提交 Issue，包含操作系统与版本、CPU/GPU、推理后端、Node.js/whisper.cpp 版本、脱敏日志与复现步骤；可提交 PR。
- 开发者可以审核并选择性合并可复现的兼容性修复，不承诺解决每个外部平台问题；**不把社区平台运行情况当作 v0.1–v1.0 的发布阻塞项**。

## 2. 用户体验与界面约束

桌面/iPad 横屏：页面**左 1/2 是暂时空白的笔记区域**，**右 1/2 是双语转写区域**；右侧上方为可独立滚动的历史句子面板，俄语左列、中文右列，每条句子成对排布，按照录音时间顺序累计。右侧底部固定两行/两块：

- 上行 `RU / Whisper`：正在识别的俄语，连续更新，允许修改尚未稳定的尾部。
- 下行 `ZH / Live`：对**整个当前可见、尚未提交的俄语缓冲区**进行临时中文翻译；可以修订，不写入正式历史。

控制区：课程名称、开始/停止录音、连接状态、录音时长、识别延迟/错误提示。后续提供句子点击播放、课程列表、导出/导入、设置面板。历史面板用户手动向上滚动时不能强制滚回底部；可提示有新句。窄屏允许改为单列，并确保实时字幕可见。

**v0.1 仅要求页面骨架 + 俄语实时字幕**，历史列和中文行可以显示清楚的“后续版本”空态，不能伪造实时结果。

## 3. 总体拓扑与部署

```text
Browser Safari/Chrome
  ├─ microphone via getUserMedia + AudioWorklet → indexed time-coded audio frames
  ├─ UI: realtime RU / provisional ZH / confirmed bilingual history
  └─ future OPFS + IndexedDB local archive
          ⇅ HTTPS + WSS
Russian VPS (Node.js application gateway)
  ├─ session lifecycle / WebSocket relay / ASR job routing
  ├─ DeepSeek sentence & translation orchestration (future)
  └─ backend stores API secrets; does not run heavy models
          ⇅ authenticated outbound worker connection
ASR host (cross-platform Node.js ASR Worker)
  ├─ first validated: macOS / Mac mini M4 / whisper.cpp Metal
  ├─ later: Linux / Windows / CPU or supported GPU acceleration
  ├─ per-session audio frame reorder/check + sliding window
  ├─ local whisper.cpp resident inference process via adapter
  └─ partial/stable transcript messages with session-audio timeline
```

- 当前俄罗斯 VPS 约 1 vCPU、1 GB RAM，仅承担轻量 Web 服务，不要求在 VPS 跑 Whisper/大型模型或长期保存全部原始录音。Mac mini 可**主动连接 VPS**，无需开放 Mac 本机公网推理端口。
- 初期单用户/单课堂会话为主；预留 session_id，避免多个连接的数据混淆。
- 浏览器录音权限要求安全上下文（公网 HTTPS），WebSocket 使用 WSS；应做最基本的登录/会话授权和 Worker 身份校验，不引入不必要的企业级权限设计。
- 所有 AI 服务地址、模型 ID、密钥应由服务端配置，浏览器不持有长期第三方 API Key。
- **v0.1 的 macOS 首次实现**：通过官方 `whisper-server` 加载多语言 `small` 作为初测候选，使用实际构建支持的 Metal 加速；官方 `/inference` 是**每段音频 HTTP 推理请求**，不是原生直播 WebSocket。实时连续识别须由跨平台 Node Worker 管理滚动窗口和结果稳定化。其他平台也应复用相同 HTTP 适配器与消息协议，仅更换对应的 whisper.cpp 可执行文件/构建及加速配置。`small`、5–8 秒窗口、约 1 秒步长是**测试起点而非已验证性能**。必要时测试 `base`、改变推理频率与窗口。
- 不把 `whisper-stream` 本机麦克风示例误当作已经可以接收远端浏览器 PCM 的服务器。

## 4. 音频采集、时间与保存的不可变约束

### 4.1 单一时间轴

- 以**课程开始后录入的音频采样序号**作为主时间轴，而不是接收时钟、Whisper 推理完成时间或服务器时间。
- 浏览器实际采样率可能是 44.1/48 kHz，不能假定 `getUserMedia` 会输出 16 kHz；采样后重采样为 Whisper 所需的 16 kHz 单声道 PCM，同时保留原始采样时间映射与采集连续性信息。
- 每个发送窗口保存：`session_id`、`frame_seq`、`start_sample`、`sample_count`、`sample_rate`；Whisper 返回的窗口相对时间按 `window_start_sample/sample_rate + relative_timestamp` 映射为课程时间。**绝不以每次推理耗时或上次识别结束时间累加**。
- 网络到达乱序、重复、断连与采样缺口要可见地记录，不能静默补假时间。`start_ms/end_ms` 是音频时间轴时间，非墙上时间。
- Token 级时间戳可能存在偏差或是实验性功能；需要带上 `alignment_quality`/来源类型，不能假定所有词级定位都毫秒级准确。

### 4.2 一份完整录音，而不是永久保存几百个句子文件

- **v0.2 起**浏览器本地持续保存原始音频，目标 90 分钟；采用分块写入/定期落盘，不在 RAM 中累积整堂课。
- 优先 `OPFS` 存音频块和照片、`IndexedDB` 存结构化索引/句子/任务元数据；检查浏览器支持和容量，必要时提供 IndexedDB Blob 后备方案。
- 每条历史句子只存 `start_sample/end_sample`（及对应 ms），点击播放时从同一份完整录音裁出范围；导出时才可选物理裁片。
- iPad Safari 后台/锁屏录音**不承诺持续有效**；第一版以前台使用为主。浏览器清理网站数据、磁盘空间不足也可能导致数据丢失，需在正式课堂使用前提供备份/导出提醒。
- 录音本地持久化与向 Mac mini 传输独立，不能由于识别错误使录音中止；无法录音时明确提示。

### 4.3 网络断开

- 网络断开时本地音频继续写入（前提是浏览器仍在前台且采集会话未中断），标记未转写的时间区间。
- 恢复连接时优先**当前课堂音频**；缺失区间后台排队或课程结束后补识别；按音频时间戳归位，不按 API 返回顺序追加。
- 这是 v0.8 功能；在此之前不得声称支持可靠断网续传。

## 5. Whisper 文本缓冲区与稳定性

维护三个不同层次：

1. `partial`：最新推理窗口中的临时尾部，可频繁变化；底部实时 RU 显示。
2. `stable_unconsumed`：通过重复识别共同前缀（LocalAgreement 风格）确认的稳定连续文字，尚未通过 DeepSeek 完整断句；底部 RU 与 partial 合并显示。
3. `committed`：已从稳定文字中按原始前缀确认并提交的句子；仅显示在上方历史，保持与音频范围对应。

- LocalAgreement 是**相邻推理输出中对齐后的稳定共同词前缀**，不是简单比较整个字符串或只按字数截取；考虑滑动窗口重叠、标点变化、重复词和识别重写。
- 首轮建议连续 **2 次**一致为确认条件，参数可调；遇静音或结束课程要做最后一次识别/flush，防止尾字永远无法稳定。
- 不因 Whisper 的句号直接把句子提交到历史；断句由后续 DeepSeek 检查处理。
- 允许稳定文本有局部错误；保存原始识别数据以便课后核对。

## 6. DeepSeek：串行增量断句、校正和翻译（v0.4）

### 6.1 定时机制（用户已确认）

- 单个会话只允许 **一个**执行中的正式断句 API 请求。
- 使用 `setTimeout(n)`，而不是 `setInterval`：**每次 API 响应处理结束后**才开启 n 秒倒计时；到期检查自上一次 API 快照后是否有新增/改变的稳定文字。
- 没有稳定文字变化则不调用 API，重新启动倒计时；有变化则读取当时 `stable_unconsumed` 的完整**快照**发给 DeepSeek。
- n 可手动设置；候选自动模式按词语增长与请求产出调整，初始建议固定 **3 秒**，将来可在 2–6 秒之间自适应。不得在每一个新增字时重置倒计时。
- DeepSeek 超时/错误后该轮应结束并按受限重试机制重新计时；Whisper 继续正常工作。
- 老师一直讲话也能断句：DeepSeek 从稳定文字中找出零个或多个已完成句子，未完成结尾留在缓冲区；长句允许先继续等待或标记临时片段，具体规则可通过测试再定。

### 6.2 单次调用的返回协议

输入：稳定缓冲区快照、版本/覆盖范围、必要的最近课堂上下文、俄语专业术语表（如有）。一次请求**同时完成：判断完整句子、保留原意进行必要俄语校正、翻译为简体中文**。输出示例：

```json
{
  "sentences": [
    {
      "raw": "Сегодня мы рассмотрим основные методы защиты информации.",
      "ru": "Сегодня мы рассмотрим основные методы защиты информации.",
      "zh": "今天我们将介绍信息保护的主要方法。"
    }
  ]
}
```

- `raw` 必须**原样摘取**本次快照开头的连续原文，不能自行增删或修改标点；`ru` 仅修正 ASR 明显错误、拼写/语法/标点，绝不能编造内容；`zh` 忠实翻译成简体中文，专业术语可中俄并列。
- 允许 `sentences: []`；允许一次返回多句；若仍有未完成尾部不作为正式句子返回。
- 服务端**逐条精确核对 `raw` 与快照的连续未消费前缀**（必要时依稳定词单元及 ID 匹配），并利用快照与版本号只消费被确认的前缀；**不信任 AI 输出的剩余文本直接覆盖缓冲区**，不进行全局字符串替换。
- 校验不通过时保留缓冲区、记录诊断，并有限重试或等待下一轮；避免无声丢字或双重提交。建议记录 `snapshot_id`、`source_start_unit_id`、`source_end_unit_id` 等服务端辅助锚点，不要求 DeepSeek 猜测时间戳。
- 成功提交后创建句子记录，状态可经历 `pending_translation`/`confirmed`；音频范围由被匹配的原始转写单位的时间区间推导，**不由 DeepSeek 生成时间**。
- 音频继续实时采集，DeepSeek 不得阻塞 Whisper/录音；旧结果不能覆盖后续新的缓冲区状态。

## 7. 底部实时中文翻译（v0.5）

- 独立于正式断句流水线，从**当前完整、尚未提交的可见俄语缓冲区（stable + partial）**获得输入。没有必要复用 DeepSeek 的句子校正或正式译文。
- 发生实质内容变化时更新翻译，不要求每次键入/词变化都即时发请求；首轮 0.5–1 秒合并/节流仅供测试，用户可设定。
- 翻译结果可随内容继续增长而重写；每次请求带缓冲区版本，新版到达后不允许旧版覆盖。
- 真实翻译 API **候选、尚未选型**：Google Cloud Translation、Azure Translator、OpenAI Realtime Translate、Gemini Live Translate；首选考虑接收文字输入的翻译服务，但保留语音翻译替代适配器。
- 翻译服务失败时仍可正常显示 Whisper 俄语。正式历史中文始终由 DeepSeek 输出，不依赖实时翻译服务质量。

## 8. 逐句音频和课后对齐（v0.6）

- 句子引用完整录音中的 `[start_sample, end_sample)` 区间，UI 显示对应起止毫秒；播放可在首尾预留可调的约 0.2–0.3 秒，不覆盖原始定位。
- 在历史句子 UI 中逐句播放；相邻句出现轻微重叠/空隙时保留真实音频时间，不强行改变正文。
- 有争议的时间戳允许人工调整、可追溯；课后可选用强制对齐提高精度（后续优化，不是 v0.6 必须引入新的模型）。
- **句子录音默认不预切存储**；只有“导出逐句音频”选项才生成真正音频片段。

## 9. 课程档案：本地保存、ZIP 导入导出（v0.7）

初步档案格式：

```text
lesson-YYYY-MM-DD.zip
  manifest.json           # schema_version、lesson_id、课程元数据、音频格式/时间轴
  audio/                  # 连续录音或可重建的顺序音频块
  transcript/whisper.json # 原始稳定转写单元、音频位置、状态
  transcript/sentences.json # raw/ru/zh、来源 ID、时间范围与顺序
  images/                 # 未来支持，当前可空
  notes/                  # 未来左侧笔记，当前可空
```

- 原始录音、时间戳、翻译、句子、课程元数据必须完整可恢复。
- 采用流式/分片 ZIP 写出，避免 iPad 浏览器一次把 90 分钟音频及 ZIP 都加载到内存。
- 导入验证档案版本、文件类型、数据结构、音频区间、文件完整性；不可覆盖现有课程（默认新建导入副本）。
- 单堂课的档案格式与未来左侧笔记兼容，但**v0.7 不实现左侧自动笔记**。

## 10. Node.js 协议约定（初稿；v0.1 需要实现并固定）

### 10.1 浏览器与 VPS（WSS）

控制事件使用 JSON Envelope，音频使用二进制帧+头部或带轻量头部的消息（避免大量 base64）。共通字段：`protocol_version`、`session_id`、`message_id`；音频帧还应包含 `seq`、`start_sample`、`sample_count`、`sample_rate`、`channels`、`encoding`。主要事件：

- Client → Gateway：`session.start`、`audio.frame`、`session.stop`、`ping`。
- Gateway → Client：`session.ready`、`asr.partial`、`asr.stable`、`session.error`、`connection.status`；后续增加 `sentence.confirmed`、`translation.partial` 等。
- 每个消息类型写清 payload 的 JSON Schema/TypeScript 类型；服务端拒绝未知 session 的帧、错误采样信息及过大帧，返回明确错误。
- 不依赖 WebSocket 消息到达时刻作为音频时间戳，连接重建后不能盲目复用旧会话流。

### 10.2 主项目与独立 ASR HTTP API

- 主项目服务端调用独立 ASR API 的 `GET /v1/models` 和 `POST /v1/audio/transcriptions`，传递 Bearer API Key、指定模型及 16 kHz 单声道 PCM WAV；API 可以单独部署于 Mac mini。
- 主项目负责重叠音频窗口调度、实时字幕、停止时 flush，以及有限次数的 HTTP 429 重试。独立 ASR API 负责鉴权、请求验证、单次推理与 whisper.cpp 适配，不依赖主项目。
- 录音时间以浏览器采样序号为准。目前 ASR API 返回窗口文字，不声称输出词级时间戳；LocalAgreement/句子时间对齐安排于 v0.3 起。
- 跨机器部署需要 HTTPS 或加密隧道，不能把主项目的 `127.0.0.1` 当成远端 Mac mini。旧 Worker 主动 WebSocket 是历史设计，不可在后续版本擅自恢复。


## 11. 分版本开发路线与逐版可见成果

> 每个版本都应给用户提供**可以自己操作和观察的网页行为**。Codex 每轮只实施当前批准版本；不要为了提前完成下个版本而增加复杂功能。前几个版本可逐步增强 UI 占位，但必须明确哪些是假数据、哪些是真接入。

| 版本 | 范围 | 用户可见成果 | 必要验收 |
|---|---|---|---|
| **v0.1** | 两仓库基础；Node.js 网页/WS；独立 ASR HTTP API；`whisper.cpp` 常驻推理；浏览器麦克风；右下角实时俄语字幕；状态与延迟 | 点击开始，说俄语时底部字幕实时变化，停止后结束，左右 2:1 布局可见 | **真实 Mac M1 联调；M4 与五分钟课堂另行验收**；连续说话 5 分钟无崩溃、无整段累计重复；报告实际延迟与所用模型；模拟测试不得冒充真实验收 |
| **v0.2** | 浏览器本地持续录音与课程列表/回放；OPFS/IndexedDB 基础、采样时间轴 | 刷新后课程仍在，可回放完整录音，看到录制时长/存储状态 | 测试录制 30 分钟与复原；长课/容量限制写清 |
| **v0.3** | Whisper 稳定文字 LocalAgreement、字幕稳定化、原始文本单元和绝对课程时间戳 | 字幕区有稳定/临时概念，重复/倒退减少；可查看时间信息 | 连续滚动识别无重复提交；比较词/句与录音位置；结束录音能 flush |
| **v0.4** | DeepSeek API 配置；串行 `setTimeout` 断句+校正+正式翻译；双语历史面板 | 右上方俄语/中文逐句累计，底部只剩未成句内容 | 一次可返回多句、空句、持续讲话；返回原文前缀验证与过时响应保护；API 超时不阻断转写 |
| **v0.5** | 可替换实时翻译接口；翻译整个底部缓冲区 | 底部 RU/ZH 两行实时跟随当前说话 | 版本防乱序、请求节流、错误不中断 RU；支持提供者配置 |
| **v0.6** | 句子和完整音频时间区间绑定、点击逐句回放 | 点击历史句子播放该句录音 | 实际起止范围准确到可用水平；不产生上千冗余音频文件 |
| **v0.7** | 课程完整 ZIP 导出/导入、版本化档案 | 一节课导出后在另一浏览器导入，文字、音频、时间全部恢复 | 校验未损坏、无重复、数据结构可迁移；大文件内存稳定 |
| **v0.8** | 自动重连、音频缺失队列与补处理、90 分钟长课测试 | 网络中断后仍本地保存，重连优先直播，课后补齐缺失识别 | 模拟断网、刷新与服务端重启边界；真实 90 分钟回归测试并记录限制 |
| **v1.0** | 右侧双语转写功能稳定、修复缺陷与文档收口 | 在作者自有设备上可靠地完成俄语课堂并可回看、备份 | v0.1–v0.8 既定功能验收完成（限作者可用硬件）；README 如实区分已验证平台与社区自测/未验证平台；左侧 AI 笔记仍不在范围内 |

**依赖关系说明：** v0.1 优先验证 macOS/Mac mini M4，但从首个版本起坚持跨平台代码分层；**不存在 v0.9 跨平台验证阶段，Windows/Linux 的适配和反馈由愿意尝试的社区用户自发推动，不影响 v1.0。** v0.1 暂不包含可靠录音持久化，**不可用于唯一一份正式课堂录音**。录音持久化从 v0.2 起是必须能力；v0.4 以后有 DeepSeek 调用成本；v0.5 的实时翻译服务仍需用户选型。v0.6 可以为逐句回放补充时间戳校正工具。

## 12. 首轮 Codex 任务：仅开发 v0.1

### 12.1 目标与交付内容

1. 在 `ru-class` 实现最小 Web 页面及 Node.js 网关：左 1/2 空白笔记区，右 1/2 转写区，俄语字幕位于右底部；显示开始/停止、连接/错误状态、当前录音秒数和可观测的转写延迟。
2. 浏览器使用安全上下文取得麦克风权限，经 AudioWorklet/合理的重采样产生连续音频帧，以 WSS 传输并为每帧带会话 ID、序号及采样起点。处理断连时给出明确提示（v0.1 不承诺补录）。
3. 在 `ru-class-asr` 实现可独立使用的 OpenAI 兼容 HTTP ASR API；主项目负责窗口调度，ASR 通过可配置适配器调用 whisper.cpp。M1 为开发联调环境，M4 后期验收。
4. v0.1 允许采用最小去重/连续窗口拼接，不要求完成 v0.3 的完整 LocalAgreement；但不得每秒无限追加相同窗口文字，也不能强制要求停止录音才产生首个字幕。
5. 给出 `docs/protocol.md` 明确字段、示例与断连行为；两个仓库分别给出 **v0.1 的独立 ASR API + 主项目 Node 应用**最小安装、启动和排错步骤；README 明确“跨平台架构，Mac mini 为作者首个验收平台；其他操作系统未由作者验证，欢迎自行部署并反馈”，提供环境变量示例，不提交真实密钥/私人域名配置。
6. 提供自动化测试：浏览器音频编码/采样元数据、WebSocket 事件、Worker 音频接收、可替换的推理适配器与模拟 ASR 接口；**另进行独立真实 Mac + 俄语录音测试**并在结果中区分自动化模拟与真实硬件验证。核心单元测试应避免依赖 macOS 专属可执行文件，便于社区将来在其他操作系统上自行运行。

### 12.2 v0.1 可执行验收流程

- 两个仓库分别安装依赖/启动（或用开发快捷脚本），日志明确显示 独立 ASR API 在线、模型已加载、实际推理后端（Metal/CPU）及操作系统；**v0.1 在 Mac M1 完成开发联调，M4 验收推迟。**
- 在支持麦克风的浏览器打开页面，点击「开始」，讲连续俄语或按实时速度送入俄语音频；右下角必须在讲话未结束时出现俄语且持续更新。
- 讲话至少 5 分钟，观察页面仍响应，字幕不会无限追加同一整段；点击「停止」正确停止采集，并回显当前状态。
- 测试网页断线、ASR API 断线、麦克风权限拒绝；页面应给明确状态，不能显示假成功。
- 在报告中给出机器与模型、推理窗口/步长、真实延迟样本（平均与高位值）、测试素材与剩余问题；**不能编造 Mac M4 实测**。如果 Codex 无法访问 Mac mini，必须明确标记 `PENDING_HARDWARE_VALIDATION`，留下可直接在 Mac 上执行的操作说明，而非宣称 v0.1 验收完成。

### 12.3 v0.1 明确禁止越界

- 不实现 DeepSeek 断句、实时中文翻译、完整录音永久存储、ZIP 导入导出、自动 AI 笔记、图片 OCR、云 GPU、复杂多用户系统；仅在界面显示未启用占位。
- 不直接覆盖当前运行的 Linux Panel 或修改其更新机制；独立应用目录/端口、独立进程，部署到现有 VPS 之前应得到用户明确授权。
- 不要为了模拟测试通过而构造看似实时的假字幕；演示模式必须显著标注。
- 不要擅自添加第三个仓库、强制容器化、全面重构或建立重型微服务框架。不得为了“跨平台”目标在 v0.1 就强制开发 Linux/Windows 的安装包或进行未经验证的兼容性声明。

## 13. 给 Codex 的长期协作规则

1. 首次开工阅读本 `PROJECT_SPEC.md`；如涉及两仓库，分别检查各自当前代码与 README，不要假设旧实验 ZIP 就是生产版本。
2. **一轮只实施一个用户已批准的版本**，并且每轮结束提供：变更摘要、涉及仓库/路径、提交 SHA / PR、运行方式、真实测试与模拟测试区分、验收结果、未完成问题、下一版候选任务。
3. 每版必须有真实可打开、可操作的结果；如用户不能直接接触 Mac mini 环境，先实现可用功能并留下明确硬件测试步骤，未通过则标记待验收。
4. 当设计与实际硬件冲突时记录取舍及最小替代方案，不擅自扩大范围；配置项使用清楚的默认值，先追求简单、可测，再迭代。**跨平台是架构目标，首版 Mac mini 实测是独立验收事实；不得混为一谈。**
5. 保留原始录音/识别数据，任何 AI 整理结果不能不可逆地覆盖原始证据；所有正式记录与音频时间轴关联。
6. 未来变更架构时更新协议文档、版本路线及决策记录；不要只改代码不改说明。
7. 不在本任务书所在的规划对话里直接开发；该对话只审查方向、设计和阶段成果。

## 14. 待定项及项目候选清单

- 远程访问域名、服务器端口和具体认证形式，正式部署前再决定。
- `whisper.cpp` 模型和窗口/步长在 Mac mini M4 的真实速度，需 v0.1 基准结果后调整。其他平台的 CPU/GPU 性能数据可由社区自愿反馈，项目作者没有建立测试矩阵的义务。
- 固定/自适应断句间隔的最优值，初始仅作为可配置参数（v0.4 开始）。
- 实时中文翻译 API 候选：Google Cloud Translation、Azure Translator、OpenAI Realtime Translate、Gemini Live Translate；**暂不比较、不预选**。
- iPad Safari 长时间录音、存储回收、前后台行为须实机验证；不承诺锁屏后持续录制。
- DeepSeek `deepseek-flash` 正式接入时以官方当时可用模型及 JSON 输出约束为准；图片理解与左侧笔记属于未来范围。
- 多角色发言分离、照片/OCR、中文 AI 笔记、自动术语表、跨课程知识库均不在 v1.0（右侧模块）当前范围内。

## 15. 参考资料（实现前复核当前版本）

- whisper.cpp 官方仓库：https://github.com/ggml-org/whisper.cpp
- whisper.cpp HTTP 服务：https://github.com/ggml-org/whisper.cpp/tree/master/examples/server
- whisper.cpp 原生 stream 示例：https://github.com/ggml-org/whisper.cpp/tree/master/examples/stream
- WhisperStreaming（LocalAgreement 研究参考）：https://github.com/ufal/whisper_streaming
- DeepSeek 官方 API 文档：https://api-docs.deepseek.com/
- 浏览器存储配额/回收：https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria

---

**实施指令摘要：** 主仓库 `ru-class`、ASR 仓库 `ru-class-asr`；**两仓库均按跨平台架构设计，v0.1 先在 Mac mini M4/macOS/Metal 真实验收；Windows/Linux/其他环境由社区自愿部署、报告问题及贡献适配，不设强制跨平台验收版本**。首先完成 Node.js 网页网关 ↔ Mac mini Node.js Worker ↔ whisper.cpp 常驻模型的链路；其余功能按照 v0.2–v0.8 逐版获得用户批准后开发，验收后进入 v1.0。

## 16. 用户实施补充 · 2026-10-16

- 当前先在 **MacBook Air M1 / 8 GB** 上开发和真实链路联调；**Mac mini M4 的正式验收安排在后期**。M4 尚未验收不阻塞当前 M1 开发。
- M1 的真实引擎结果、合成俄语重放、模拟测试和 M4 正式验收分别记录，不将任何一项冒充另一项。
- 当前仍只开发 v0.1，后续版本范围及生产部署授权规则不变。

## 17. 用户界面与凭证规划补充 · 2026-10-16

- 页面固定占满视口（100% 高度），页面本身不能滚动；桌面左右各 1/2。窄屏保留单列，字幕保持可见；长历史及字幕只在各自容器内滚动。
- 移除可见顶栏品牌/版本/副标题及底栏提示，版本限制继续保留在文档中。
- 右上角增加设置按钮，将网关访问令牌移入设置弹窗，仅保存在页面内存。
- 按语音识别、多模态、语言模型三类规划服务配置；本轮只展示规划状态，不开发新模型接入。本地 Whisper 不需要模型 API 密钥。未来模型密钥保存在服务端，与 CLIENT_TOKEN / WORKER_TOKEN 应用认证分开。

## 18. Recording controls and caption state revision (2026-10-16)

The user's latest UI direction supersedes earlier control placement: course name belongs at the top of the left workspace (a compact top row on narrow screens). Remove the caption heading/window caption and show only RU/ZH labels. The live panel toolbar has time on the left and one start/stop recording button on the right. The RU area shows connection status while disconnected and the start-recording placeholder only after an authenticated Worker-ready connection; errors and stopped states remain explicit. Settings stays at top right and holds the gateway token plus Worker diagnostics. No new version or model integration is authorized by this UI revision.

## 19. Global bottom recording toolbar (2026-10-16)

The latest user direction moves recording controls to the bottom of the entire viewport. Order: single start/stop recording button, recording duration, window/inference/audio-end-to-display metrics, Settings at the far right. This supersedes the placement in sections 17–18. The toolbar takes its own layout row; desktop content remains equal halves, narrow screens keep the same control order, and the document stays fixed to the viewport. No audio, authentication or future-version scope changes.

## 20. User correction: independent ASR API and right-half toolbar (2026-10-16)

This explicit user correction supersedes prior Worker topology and section 19 toolbar placement. ru-class-asr must independently serve an OpenAI-compatible transcription API with URL and key. ru-class calls it on the server, owns rolling audio window scheduling and exposes API address/model/key configuration in Settings. Local use must not require manual entry of a gateway token. Keep site authentication separate from provider credentials. The bottom toolbar belongs at the bottom of the right 1/2, not across the page. Current implementation contract and limits are in docs/api-integration-v0.1.md; this remains v0.1 and does not authorize later model integrations or public deployment.
