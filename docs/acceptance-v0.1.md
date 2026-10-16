# v0.1 development delivery and acceptance report

> **状态复核（2026-10-16）**：本报告记录的是 v0.1 旧架构的开发联调结果，**不是 v0.1 正式验收完成证明**。原报告已明确：M1 Metal + 101.16 秒合成音频联调通过；五分钟自然俄语/真实麦克风、实际浏览器中断与端到端延迟，以及 M4 正式硬件验收仍待完成或被延期。此后主程序已改成 **浏览器直连第三方 ASR + IndexedDB**，旧 WebSocket 路径验收不能直接算作新路径验收。当前仓库显示 v0.2.2 是功能开发版本号，**不代表 v0.1 已完成验收或 v0.2 已通过里程碑验收**。不要为了 UI 微调继续递增版本号；正式课堂使用之前，需使用真实录音评估识别质量、重叠窗口重复/错字、尾部 flush、至少五分钟持续录音及本地 WAV 能否完整恢复；M4 正式验收继续单独标记待办。


Date: 2026-10-16. Scope: PROJECT_SPEC.md revision 1.2 plus the user's M1-first implementation clarification. Only v0.1 is implemented.

**Current delivery: M1_DEVELOPMENT_READY / AUTOMATED_TESTS_PASSED / M1_REAL_ENGINE_SMOKE_PASSED.** Mac mini M4 formal acceptance is **PENDING_HARDWARE_VALIDATION**, intentionally deferred by the user. It does not block M1 development.

## Delivered implementation

- Independent Node.js/TypeScript gateway and Worker projects with lockfiles, standard browser JS and fixed protocol 0.1. Architecture and module ownership are recorded in `architecture.md`.
- Browser microphone permissions, AudioWorklet channel mixing and streaming low-pass resampling from actual source rate to 16 kHz mono PCM16; binary audio frames carry session, sequence, target sample position and original sample mapping.
- Independent client/Worker tokens, exact browser origin check, session ownership, bounded message sizes, strict audio metadata and continuity validation, heartbeat and explicit failures. Local secrets remain ignored and readable only by the local user.
- Worker-initiated connection to gateway, platform-neutral resident whisper-server HTTP adapter, actual startup inference probe, bounded overlapping windows and serial/coalesced inference. Stop flushes remaining input; cancelled sessions suppress stale results.
- Actual 1:1 fullscreen desktop page and narrow layout, replacement RU live window, duration/state/error indicators and separately labeled latency metrics. Chinese/history features remain explicit future-version placeholders.
- macOS/VPS setup and troubleshooting, real-time replay driver, synthetic developer text fixture, tests, architecture decisions, development log, backend evidence and honest acceptance limits. No production service was modified.

## Verification

Environment: macOS 27.0, Apple M1 / 8 GB MacBook Air, arm64, Node.js v25.9.0, npm 11.12.1. Results below do not imply other OS/browser/Node versions have been author-tested.

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Main automated suite | PASS 12/12 | `ASR_REPO=../ru-class-asr npm test`; audio resampling/encoding, sampling metadata, malformed frames, continuity, WS auth/origin/session routing/errors, browser permission/HTTPS checks, capture/stop/disconnection/mute lifecycle |
| Joint contract and complete chain | PASS, simulated engine | Real HTTP adapter → real Worker → real gateway → WS client with `SIMULATED_TEST` output; early partial and final tail checked, protocol source/doc copies match; actual replay CLI smoke-tested with 2.2-second synthetic fixture |
| Worker core suite | PASS 6/6 | Accelerated five-minute simulated frames stay within 8-second buffer; WAV format, single inference, coalescing, flush, empty stop, cancellation, HTTP response/error handling |
| Both typechecks and builds | PASS | `npm run typecheck` and `npm run build`, directly in both target repositories after `npm ci` |
| Runtime dependency audit | PASS | `npm audit --omit=dev`: 0 vulnerabilities; both projects share the same locked runtime dependency |
| Actual in-app browser visual/interaction smoke | PASS, limited | 1366×900 and 390×844; correct layout/placeholders, missing-token prompt, no console warning/error observed. No physical microphone capture was used in this smoke |
| M1 actual Whisper/Metal chain | PASS, development smoke | Actual multilingual small and actual Metal logs; 101.16-second synthetic Russian WAV paced in real time, 506 frames/101 results, captions before stop, stop acknowledgment; see `m1-development.md` |
| Public-source review | PASS for delivered files | No real credentials/private keys or personal absolute paths found. Local env, raw logs, audio, models and generated artifacts are ignored. Committed media is limited to clean UI screenshots; test source text is synthetic |

Each repository's full successful automated output is retained in [test-results-v0.1.txt](test-results-v0.1.txt). Actual M1 measurements, model hash, engine revision and methodology are in [m1-development.md](m1-development.md), [metrics](m1-replay-metrics.json) and [backend evidence](m1-backend-evidence.txt).

Automated DOM stubs and `SIMULATED_TEST` HTTP fixtures prove logic only. Accelerated five-minute synthetic frame input is not a five-minute hardware run. The M1 real engine run uses explicitly synthetic speech and lasts 101.16 seconds; it is not the required M4/natural classroom acceptance.

## PR #13 初次真实课堂回归 FAIL 与第二轮 P1 修补（2026-10-16）

**Codex 对 PR #13 初次 head `6b7891db15ce82711c96fdbbfaf82e0830913fb9` 的实际 C1/C2 私有缓存结论：FAIL，严禁合并该版本。** 45 个原同采样重投及 227 个首次停止前缀继续为 0，但 C1 最终词数 **828→272**，C2 **717→156**，且 PR 在 **所有非 final 识别窗口中 stable_delta 均为空**（原 main 分别 45/39 次含最终提交）。C2 原窗口索引 78（84.2–92.2s）显示 214→109 词，多个此前显示的独立话题永久丢失。原 14 条真实窗口的缩减复现仅在用户 Mac 私有目录，未公开上传；不能把重复候选归零当作成功。

**两项 P1 根因与本轮修改：**

1. `replacedDraft` 曾错误使用 `commonPrefix`（词面锚定函数）判断数组内容是否完全一致；独立 `-` 经过归一化 `key=""`，故同一 token 也不能通过 `equal()`。目前改用 `sameSequence()` 比较 token 表示是否一致；同时为稳定前缀比较 `commonPrefix` 单独支持**完全相同的纯标点 token**，但 `overlap()` 仍然禁止纯标点作为音频锚点。
2. 历史文字长时间留在可变 `pending` 中，被后续仅 8 秒的 ASR 假设大面积覆盖。增加 **64 token 最大可变可见草稿上限**：每个新采样区间在尝试新窗口重对齐**之前**，先将当前已显示的旧前缀迁移至不可回写的 `stable`；在一次更新结尾再检查上限。64 不是实测语速或真实词级时间戳，只是防止无限可变历史的保守兜底，仍可能冻结原本可修正的错词，因此需要真实回归验证。

新增无隐私内容的自动化用例：首条识别以独立 `-` 开头时第三个窗口必须正常提交稳定前缀；200 token 待确认课堂历史遇到一个较短的新窗口时必须保留明显早于 8 秒窗口的部分；连续多窗口必须在停止前逐步产生 `stable_delta`；原 PR #12 幂等/首次停止门禁保持不变。

**增强的私有 C1/C2 A/B 工具** `scripts/compare-transcript-caches.mjs`：新增 `nonFinalStableUpdates`、`firstNonFinalStableSample`、`maxVisibleWordDrop`、`largeVisibleDrops`、`maxMutableWordsObserved`。以下情况工具额外设置 `reviewFlags` 并以非零状态退出：候选正常识别期间完全没有稳定提交；出现显著大于旧版本的单次可见历史缩减；最终词数相对 main 大幅减少。**这些只是高风险回归预警，不是能证明没有漏句的准确率标准。**

**当前状态：第二轮提交仅通过合成 CI；真实缓存尚未复验。** 在 Mac 上用独立的 `pr13-regression` 测试环境和原 121 条 C1 / 106 条 C2 缓存再次执行全部原始检查，特别是 `punctuation-regression.mjs`、`minimize-loss.mjs`、`loss-audit.mjs` 与官方 A/B 工具。要求恢复**正常的非 final stable_delta**、前 14 条真实缩减反例不能再吞掉旧独立段落、C2 索引 78 无大段历史删除，同时 45/227 门禁仍为 0；私有逐词 diff 复查真实重复讲话后，才能考虑合并。不得单凭统计减少而合并。整体 v0.1 仍未完成课堂验收。

## PR #12 合并后：移动窗口跨区间重复固化专项修复（待 Mac 真实缓存复验）

针对 PR #12 合并后的剩余问题：真实课堂缓存中，C1 (121 窗口) 最终至少 5 词重复候选跨度为 **36**、稳定提交候选 **30**，C2 (106 窗口) 为 **32 / 25**。这些是词面筛查候选，不能全部等同老师未说过的内容；用户真实重复发言必须保留。原 45 个同采样范围重投、16/11 个首次停止前缀复发已在上轮由本机 Codex 验证为 0。

本分支的**有限范围、待验收**变化：

- `overlap()` 选择同长度词面匹配时，优先将新窗口中**较早出现的**锚点与旧窗口尾部对齐，避免把第二次相同短语误当作旧内容吸收。
- `unanchored` 连续窗口被证实时，如果显示层 `effectiveDraft()` 已用新版本覆盖旧 `pending`，就基于**可见有效草稿**延续新尾部，不把被取代的草稿再次提交为稳定词。
- 添加俄语重复短语、稳定尾部锚点、多窗口文本变化、真正不相交音频重复和所有中途停止前缀的合成测试。
- **未添加词级时间戳，不会推断真实说话时刻**；窗口交叠且两次发言分别落在不交叠的声音区间时，仅凭 Whisper 整窗文本仍无法可靠区分，不得夸大修复范围。

**PR #13 新增本地 A/B 对比命令（不输出课堂原文）**：从 `ru-class` 仓库里先 `git fetch origin main`，然后在 PR #13 的独立 checkout 中运行：

```sh
node scripts/compare-transcript-caches.mjs \
  origin/main HEAD \
  /private/C1-fixed-windows-converted.json \
  /private/C2-realtime-windows-converted.json
```

该脚本直接从本地 Git 提取两个版本的 `apps/web/transcript.js`，在相同的私有原始窗口数组上运行真正的浏览器 `TranscriptBuffer`，不请求网络或 Whisper，不输出任何转写原文。比较输出各版本最终词数、字符串长度、重复 5-gram 出现起点、临时重复窗口次数、完整文字编辑距离、每个前缀首次停止一致性、同采样窗口幂等性和稳定前缀不回写。使用的重复 5-gram 指标**不能**直接对标 Codex 早先报告的 36/32 个“重复候选跨度”（口径不同），不是真实重复错误数。正常结束时打印统计 JSON；验收还必须运行 Codex 原 `pr12-second-round` 独立 harness 并在私有目录审查文本差异，防止删掉老师真实重复发言。发现任何新异常必须继续保留 PR 不合并。

**Mac 私有缓存必做复验：**沿用 Codex 已建立的 `classroom-benchmark-20261016/private` C1/C2 缓存与 `pr12-second-round` 严格回放流程，在 PR 新分支分别对比 main 与候选版本，至少列出最终稳定提交重复、临时重复、词数、全部 227 个首次 stop 前缀和原 45 个重投反例。任何新漏句、真实重复被吞或停止增字都应阻止合并。保留用户原始音频与识别文本在本地，不上传公开仓库。

**整体 v0.1 仍未验收完成**：独立人工听校真值、5 分钟真实录音、真实浏览器麦克风到屏幕延迟及 M4 后期验收均待完成。

## PR #12 第二轮修复：针对私有真实缓存复审 FAIL 的整改（2026-10-16）

用户的 Codex 在私有真实录音窗口缓存上复审 PR #12，结果为 **FAIL / 暂不合并**。已经**验证**原 45/120 个同区间重投显示增长反例为 0；C1/C2 重投均不产生新 stable_delta，也不影响正常回放结果。首次修复并未消除主要最终重复：C1 重复候选跨度 36→36，稳定重复 30→30；C2 33→32，稳定重复 26→25。

复审又发现两项 P1 确定性回归：

1. 新的 `unchanged` 提前返回路径没有重置 `emptyWindows`，输入 speech → empty → same speech → empty → corrected speech 会提前固化旧错词。
2. `state()` 折叠的 `pending/unanchored` 只用于显示，`flush()` 却提交原始 pending 后再匹配 unanchored；若用户在真实缓存的任意中间前缀停止，C1 有 16 个、C2 有 11 个位置恢复已消失的旧词。

**本轮修复**：对所有新的非空区间（包括词面未变化的区间）中断空白计数；统一 `effectiveDraft()` 作为实时渲染和 `flush()` 的唯一草稿对齐出口。新增非连续空白纠错、草稿替代、稳定尾部重叠、逐前缀首次停止和真实窗口 JSON 私有回放的回归断言。严格保留原同区间幂等性和不重叠音频的真实重复讲话；不改 Whisper、8s 采样窗口、API、版本号。新私有回放脚本额外检查 `firstStopVisibilityViolations` 和 `plainVsInjectedMismatches`，保留 final 标志。

**状态**：这些修改在 CI 的合成测试通过，不等于 C1/C2 真实缓存回归通过。仍须在 Mac 上对 121/106 个原始窗口跑完整基线对照，至少确认：已知 45 个反例维持 0、所有中途停止首次 flush 增字 16/11→0、稳定/临时重复和漏句没有新回归。最后两者若不能确认，PR 继续保持未合并。实际移动窗口残留重复是**独立的待修复问题**；没有人工真值，不能把词数减少宣称为准确率提高。

## 修复待验收：浏览器 TranscriptBuffer（2026-10-16）

基于用户在 Mac M1 上用 121.95 秒真实课堂录音完成的私有测试报告，现有浏览器 `apps/web/transcript.js` 被确认：**相同音频采样范围再次提交同一识别结果，120 次重放中的 45 次出现额外文字增长**；Web UI 的 `pending` + `unanchored` 也可能显示同一窗口的两个版本。原始 Whisper 同时存在错词与默认 beam 退化，两类问题独立。本轮只修复浏览器拼接层，不更换 ASR 模型、解码配置或窗口/步长。

本分支改动：

- 同一采样区间结果幂等处理；同区间不同解码不视为另一段发言；相邻重叠区间内容未变时也不额外添加同一原文。
- 非重叠音频区间允许保留真实重复讲话。
- 优先对齐已有候选和最新重叠窗口，草稿重叠时避免 `pending` 与 `unanchored` 直接整段重复显示。
- 仅使用合成、无私人音频的单元测试验证上述不变式；不会声称 CI 测试已解决真实语音的全部错误。

**本地私有原始窗口结果再验收（尚需在持有缓存的 Mac 上执行）**：

```sh
node scripts/replay-browser-transcript.mjs /private/path/fixed-windows.json
node scripts/replay-browser-transcript.mjs /private/path/realtime-windows.json
```

脚本接受 JSON 数组（也接受 `{"windows":[...]}`、每行一条 JSON）；每条记录需包含 `text`、`window_start_sample`、`window_end_sample`，采样时间单位均为 16kHz 采样点。若本地缓存字段不同，需要先在本机转换为该格式。脚本不上传音频、不打印识别文本，仅输出窗口数、同采样范围二次投递的重复错误计数及最终词数。

**验收不能跳步**：必须由 Codex/用户在有 121 与 106 条本地实际 ASR 缓存的 Mac 上分别回放，确认之前的 45 个无新音频重投反例归零；还需前后对比重复候选数、漏句、稳定文本、真实重复讲话和停止收尾，不得凭“重复率下降”宣布准确率通过。五分钟自然俄语、真实麦克风与 M4 硬件验收继续 `PENDING`。

## Actual M1 performance summary

Multilingual small; 8 s maximum window, 1 s step, 2 s first threshold. In this one warmed run, HTTP inference averaged 763.2 ms with p95 852.9 ms. Audio-frame-end sent to replay-result received averaged 771.9 ms with p95 863.9 ms. The latter excludes microphone buffering, AudioWorklet/frame batching and UI rendering, and must not be presented as complete acoustic subtitle latency. The backend was verified from actual `using MTL0 backend` / `Apple M1` startup lines, independently of the Worker's honest unverified configuration label.

## Deferred formal acceptance and remaining checks

| Requirement | Status |
| --- | --- |
| Mac mini M4 actual hardware/model/Metal and performance | PENDING_HARDWARE_VALIDATION; intentionally deferred |
| At least five minutes of natural Russian/microphone or authorized real-time replay, responsive live page and repetition review | Deferred formal acceptance |
| Physical microphone capture and foreground Safari/iPad behavior | Operator/device validation pending; standard API and simulated lifecycle tests are complete |
| Actual browser network/Worker interruption while recording | Automated paths passed; real browser/device interruption check pending |
| Complete acoustic-to-subtitle latency | Not measured; replay transport/inference figures above are separately labeled |
| Production VPS HTTPS/WSS deployment | Not performed; requires separate deployment authorization |

Follow [hardware-validation.md](hardware-validation.md) at the later M4 stage. Record M1 and M4 findings separately, retain raw private evidence locally and commit only redacted findings.

## Known v0.1 boundaries

Only the newest overlapping RU window is displayed; no full transcript archive or stable LocalAgreement exists. Slow inference coalesces pending work and can leave earlier audio unrecognized; it bounds memory and keeps current input. Window ranges are not word alignment. No permanent classroom recording, browser reconnect/recovery, translation, committed bilingual history, sentence playback, ZIP archive or AI notes was implemented. v0.1 must not be the only copy of important classroom audio. Later versions require explicit user direction.

Implementation source baselines: main `d07280d4a8f51ba93907388f90be1ac7f0426a4c`, M1 browser lifecycle refinement `8a3be3715ced8013d6a23c9d3fcf2500ac3ef414`; Worker core `0134b428f080e24a35bcc7dd3b8eafb6c19d8f2a`. Subsequent commits record evidence. Git history is local; no GitHub push, release tag or production deployment was performed.

UI revision 2026-10-16: fixed viewport, equal desktop columns, no document scrolling/top/bottom bars; gateway token moved into Settings. This UI change leaves audio and inference protocol unchanged. Layout checks are recorded in the development log.

UI revision checks passed: 1366×900, 390×844 and 900×400 document heights matched viewport heights. Desktop widths were 683/683. Settings open/close and missing-token redirect were checked in the actual browser; main regression 12/12, typecheck and build passed. No new model integration or key storage was added.

Compact-controls revision 2026-10-16: left workspace course input, one recording button/right with timer/left, RU/ZH-only labels and connection-aware RU placeholder. Main regression 12/12, typecheck/build and desktop/narrow visual checks passed; source lifecycle state tests use explicit browser stubs. See ui-recording-controls-v0.1.md.

### Global bottom toolbar (2026-10-16)

Moved record toggle, duration, metrics and Settings into one viewport-wide bottom row. Supersedes earlier live-toolbar/top-right Settings placement. Main joint regression 12/12, typecheck and build passed. Actual browser at 1366×900, 390×844 and 900×400 confirmed no document overflow and toolbar at viewport bottom; Settings open/close passed, no warning/error observed. Public-source scan passed. Audio protocol unchanged; M4 formal acceptance remains deferred. See ui-bottom-toolbar-v0.1.md.

## Current API boundary correction (2026-10-16)

The user corrected the topology: ASR is an independent OpenAI-compatible HTTP API, called by the main server using base URL/model/key. Current entry points no longer require an outbound Worker; local browser authentication is automatic. Toolbar is inside the right half. Earlier Worker-topology and full-width-toolbar descriptions/measurements are historical. Main 13/13, ASR 7/7, both typechecks/builds passed; real M1 8 s synthetic Russian API replay produced 6 results before stop with tail completion. M4 remains deferred. Full contract, credential boundary, measurements and limits: [api-integration-v0.1.md](api-integration-v0.1.md).
