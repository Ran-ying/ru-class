# P1 · 阿里云百炼北京 Qwen3-ASR 官方 API 交叉验证

**状态（2026-10-17）：已实现并自动化验证官方请求结构；需在持有北京地域 API Key 的设备上执行三段真实识别。** 此方案替代本地 MLX 模型下载的做法，不需要下载模型、安装 Whisper 或 OpenAI SDK。

> 此步骤会主动把三段私有课堂音频（每段的完整上下文和精确 8 秒目标窗各一次，合计 **6 次请求**）上传至您自己的阿里云百炼北京地域。与此前纯离线方案的隐私范围不同。只在获得课堂录音合适授权、接受云端处理后运行。

## 官方接口

- 模型：`qwen3-asr-flash`，与原 Whisper 不同的识别模型家族。
- 默认地域：**北京**；旧公共兼容域名 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`。
- 若你的北京业务空间提供 Workspace ID，优先使用推荐的 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`，脚本参数 `--workspace-id` 会自动构造经过白名单校验的 HTTPS 主机名。
- 请求使用 `messages[0].content[0].type=input_audio`、`input_audio.data=data:audio/wav;base64,...`，`asr_options.language=ru`，`stream=false`；音频为 16 kHz mono PCM16 WAV。
- API Key 仅来自当前终端的 `DASHSCOPE_API_KEY` 环境变量，不写入任何脚本、仓库或生成报告。不能把真实 Key 粘贴到 GitHub Issue、PR 或日志。

官方文档：[Qwen-ASR API 参考](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)。

## 一次性执行（Mac 上的 Codex 可直接接手）

无需下载模型，也无额外 Python 依赖。Python 3 标准库即可。请在 **RU-Class 最新 main** 操作。

### 1. 配置北京地域 API Key

不要把 Key 直接放进会记录在 shell history 的命令行参数。

```sh
# 在当前终端安全粘贴 API Key（输入不可见）
read -s DASHSCOPE_API_KEY
export DASHSCOPE_API_KEY
echo
```

也可以让密码管理器或现有的本机安全凭证系统设置此环境变量。**此变量必须是北京地域可用的 Key**。不要将真实 Key 提交到仓库，也不要让 Codex 把环境变量打印到日志。

### 2. 先验证私有 WAV 与时间坐标（0 次云 API 请求）

```sh
cd /path/to/ru-class
python3 scripts/cross-validate-dashscope-asr.py \
  --private-root /Users/ranying/Documents/Codex/2026-10-17/p1-private-audio-audit/private \
  --region beijing \
  --dry-run
```

输出必须为 `VALIDATED_INPUT_ONLY_NO_API_REQUEST`，包含 C1 #30、C2 #77、C1 #120 三段输入，**没有独立语音识别结果**。

### 3. 调用北京地域 Qwen3-ASR（6 次 API 请求）

```sh
python3 scripts/cross-validate-dashscope-asr.py \
  --private-root /Users/ranying/Documents/Codex/2026-10-17/p1-private-audio-audit/private \
  --region beijing \
  --output-dir /Users/ranying/Documents/Codex/2026-10-17/p1-qwen-beijing-private
```

`--region beijing` 可以省略，因为默认是北京。如果需要专属业务空间域名，请再添加 `--workspace-id <真实 Workspace ID>`；不指定时使用仍受支持的北京公共兼容域名。

`--output-dir` **必须是此前不存在的新目录**，防止覆盖旧验收记录。目录以 0700 权限创建；里面的 `cross-asr-private.json` 仅所有者可读。

本步骤会上传 3 段已存在的本地 WAV，各识别：

- 完整上下文：C1 #30 12 秒、C2 #77 12 秒、C1 #120 10 秒。
- 与原 Whisper 请求完全一致的焦点 8 秒音频范围，用于更公平的比较。

**只上送这六个短音频样本，不上传全部 121.855 秒课堂录音。** 云端返回的原始文本、原 Whisper 相邻窗口和逐片段比较详情只保存在本机 JSON；终端只输出状态和归一化词数、文本相似度等数值。未调用 Whisper，不修改生产字幕，也不会自动提交仓库。

### 4. 获取结果并开展中文审查

完成后，Codex 读取私有 `cross-asr-private.json`，对三个目标窗逐段：

1. 比较原 Whisper 单窗文本与 Qwen3-ASR 8 秒识别及上下文识别。
2. **C1 #30**：判断前一未锚定窗口是否含有 Qwen 也识别到的付款主题；是否被 reducer 排除，还是 Whisper 错读。
3. **C2 #77**：判断独立识别是否出现异常的重复文本，与 Whisper #76 的 164 词循环作对照；如两者不一致，应倾向复核原模型的幻觉，而非直接算作 151 词漏句。
4. **C1 #120**：核查最后几秒真实可识别的语义以及 Whisper final 是否更接近第二模型。
5. 用中文解释各模型分歧和可信程度。不要自动把任一模型当成真值；没有懂俄语者的真实听辨时，人工分类继续为 `INDETERMINATE`。

**模型一致 != 人工听校完成。** 独立模型可提供另一条证据，不能证明词级时间定位或最终准确率。若需要人工确认关键歧义，仍需俄语能力足够的审查者。

## 安全、费用与验收边界

- 请求目的域名仅允许阿里云百炼北京/新加坡公共兼容域名及经校验的业务空间专属域名；该任务的默认是北京。运行时 HTTPS，禁止重定向。密钥及转写不进入日志。
- 使用 Base64 Data URI 将 WAV 原始字节置于 HTTPS 请求体。**这是向云服务传送语音，不是纯本地推理**；实际费用遵循你的北京百炼账户模型价格和计费情况。
- 输入过大、无 Key、域名参数错误、网络失败等会返回可识别错误码；不输出敏感网络响应正文。
- GitHub CI 使用伪造 API 响应的六项测试，不联系阿里云、不花费额度。运行成功不能当作真实模型输出已验收。
- 完整 C1/C2 回归（45 个重投反例、227 个停止前缀及逐窗比较）仅在未来单独实验分支替换字幕 reducer 时重新执行。
- P0 PR #14 Safari IndexedDB 验收仍独立，**P2 长时间录音/整段回放/恢复继续暂停**。
