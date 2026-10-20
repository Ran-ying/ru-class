# RU-Class v0.5 — MacBook Safari + Mac mini M2M100 联调验收

## 现状与边界（2026-10-20）

- Mac mini M4 已将 Whisper Small/Metal 与 M2M100 418M INT8/CPU 同时加载成功。
- 在 Mac mini 上，`127.0.0.1:8091/translate` 测得一个短句推理 293 ms；
  `127.0.0.1:3000/v1/translate` 使用 Bearer 测得另一个短句往返 357 ms。
- 上述两次调用**不是 Safari 端到端测试，也不是持续并发负载或 P95 测试**。
- v0.5 网页不设置公共默认翻译地址，不储存新 Key；仅复用每位用户设置的语音 API
  `baseUrl` 和 Token。正式双语历史仍由 v0.4 DeepSeek worker 持久化。
- 网页只能使用 HTTPS 的自选 API（或同设备的 localhost）；**远程访问 Mac mini
  必须通过已有安全 HTTPS 反向代理/隧道**，不可把 8091 的无认证私有 Python
  服务公开到互联网。HTTPS 反代的目标应是 Node API（本次设备日志为 3000），
  路由 `/v1/translate` 应与已有 `/v1/audio/transcriptions`、`/v1/models`
  一样透传到 Node。只有 Node 端处理 Bearer 和 CORS。

## A. Mac mini：私有 API 与端口

请保持 `bash scripts/mac-classroom.sh run` 前台运行，
另开一个终端检查：

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
lsof -nP -iTCP:8091 -sTCP:LISTEN
lsof -nP -iTCP:3000 -sTCP:LISTEN
curl --noproxy '*' -fsS http://127.0.0.1:8091/health
```

实际端口以**你的 config.json** 为准；此例与当前 Mac mini 启动日志一致。
不要打印配置文件里的 API Key，不要将 Key、真实录音、课堂原文提交 PR。

## B. HTTPS/CORS：从 MacBook 网页所在的 Origin 测试

在 MacBook 打开 RU-Class 网站，浏览器控制台运行
`location.origin` 并记下实际值。Origin 包含协议和端口，
例如本地 `http://localhost:3000` 或自有站点
`https://your-site.example`，请不要照抄示例地址。

浏览器配置的语音 API 如为 `https://ai.rany.ing/v1`，
翻译 URL 必须是 `https://ai.rany.ing/v1/translate`。
在 MacBook 终端进行**不含 Key**的预检（下面将 Origin 改成上一步所见）：

```bash
WEB_ORIGIN='https://your-ru-class-site.example'
curl -sS -i -X OPTIONS \
  'https://ai.rany.ing/v1/translate' \
  -H "Origin: $WEB_ORIGIN" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
```

期望 HTTP 204，响应中
`Access-Control-Allow-Origin` 与 `$WEB_ORIGIN` **完全相等**，
`Access-Control-Allow-Methods` 包含 POST，
`Access-Control-Allow-Headers` 包含 Authorization/Content-Type。
不是 204 时，检查 Nginx 对 OPTIONS 的反代、`config.json`
`cors.allowedOrigins` 是否包括**准确的网页 Origin**、以及 Node 的
`translation.enabled=true`。不要通过关闭浏览器安全策略“解决” CORS。

在 Mac mini 本机，可以继续使用现有受认证的 Node 测试以区分
「模型故障」和「远程反代/CORS 故障」：

```bash
ASR_TEST_KEY="$(node -p "require('./config.json').apiKey")"
curl --noproxy '*' -fsS http://127.0.0.1:3000/v1/translate \
  -H "Authorization: Bearer $ASR_TEST_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary '{"text":"Это тест локального перевода.","source":"ru","target":"zh"}'
unset ASR_TEST_KEY
```

API Key 只留在本机 shell 变量中；不要启用 shell `set -x`，
也不要把含 Authorization 的命令直接贴到公开日志中。

## C. MacBook：v0.5 前端交互

1. 更新 RU-Class v0.5 网页代码并刷新（Node `npm run dev` 或你的静态 HTTPS 站点）。
2. 在「设置 → API 配置 → 语音」保留原来的语音 API URL、
   模型 `small` 和已有 Token，勾选**启用本地实时中文**。
   此选项仅保存在当前浏览器；未勾选时网页仍是纯 v0.4 行为。
3. 选择一节课，开始录音。下方 RU 出现稳定/临时文本后，
   ZH 应能显示中文，右下方同时显示本地请求耗时（毫秒）。
4. 连续讲话与停顿：下方中文允许随 Whisper 修改，
   但不会在同一个录音中被更旧的翻译结果覆盖。
5. 观察上方俄中历史：只有正式 DeepSeek 校正/保存后的句子进入，
   下方临时译文**不得**重复添加到上方历史。
6. 快速开关、停止录音、切换课程：旧请求不可污染新的录音，
   停止后不应新增下方翻译。API 失败也不能中断俄语录音。
7. 重复说相同短句、让 Whisper 修改句子为 A→B→A，
   仍必须为新的字幕修订产生新的可用译文。
8. 没有 `/translate` 的第三方 ASR URL 应显示“不支持本地翻译”，
   不能导致录音失败或创建默认云翻译账单。

建议在 Safari「开发 → 显示网页检查器 → 网络」查看
`translate` 请求。验证其请求地址与当前设置一致、
`200` 响应有 `translation/source/target/model`，请求不携带 Cookie，
且没有向 RU-Class 公共页面服务器泄露 Token。
可记录耗时、HTTP 状态和模型名，**不要分享含 Bearer 的完整网络导出**。

## D. 长时间与性能记录（非发布阻断的第一轮联调）

用自有非敏感俄语样本在 Whisper 单独运行、本地翻译单独运行、
联合运行三种配置下测：
- 总共 30 分钟录音不中断；
- 30–100 次翻译请求的 P50/P95（包含 Node HTTP）和 429/超时次数；
- Whisper 识别频率与推理耗时、运行时 CPU/内存压力；
- 中文出现延迟从**下方 RU 改变时刻**起算，区别 ASR 自身延迟；
- 正式句子入库与下方实时字幕无重复、丢失或旧译文覆盖。

目前不能写“长课验收成功”或“P95 500ms 达标”，
直到真实 Safari 和联合负载记录支持这些结论。


## E. v0.5.1 新增验收：完整缓冲与及时上移

- 检查当前页面版本显示 v0.5.1，录音时下方中文必须使用正常深色，
  而不是因为后续俄语不断变化一直呈灰色。
- 使用两段已确认俄语（8 秒滚动窗口前的稳定部分）以及最新 8 秒附近
  的 ASR 临时句子；比对下方中文是否覆盖**全部下方 RU**，而不是
  仅从最后 1100 字符处开始。由于本地模型的单请求限制，会分段
  显示，在完成前有「已译段数/总段数」状态。
- 观察 DeepSeek 正式历史：两个不同音频窗口一致确认的完整句子
  应尽早进入正式翻译队列；成功保存后的俄中句对立即显示在上方。
  用户向上阅读历史时不自动跳回底部；已经在底部则继续跟随新句。
- 真实课堂口语可能没有句号或发生 Whisper 改写。若语义尚不确定，
  正式历史继续等待，不允许以牺牲原文确认和持久性换取固定延迟。
