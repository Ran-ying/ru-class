# RU-Class 反向代理与配置指南（v0.1.1）

## 配置文件

从项目根目录复制 `config.example.json` 为 `config.json`（后者在 `.gitignore` 中）。默认从当前工作目录读取，也可使用 `RU_CLASS_CONFIG=/absolute/path/config.json` 指定位置。配置文件请限制为仅服务用户可读（`chmod 600 config.json`）。

```json
{
  "listen": {"host": "127.0.0.1", "port": 4189},
  "site": {
    "publicOrigin": "https://class.example.com",
    "accessToken": "REPLACE_WITH_A_RANDOM_TOKEN_OF_AT_LEAST_24_CHARACTERS"
  },
  "asr": {
    "baseUrl": "https://asr.example.com/v1",
    "model": "small",
    "apiKey": "REPLACE_WITH_THE_INDEPENDENT_ASR_API_KEY"
  }
}
```

`listen.port` 可设为 1–65535 之间的整数；`listen.host` 默认 `127.0.0.1`，推荐通过同机 Nginx 反向代理访问，无需开放 Node.js 端口。上述域名是占位符，不是项目预置域名。

- 本地：`site.publicOrigin` 留空。仅允许在 loopback 监听，浏览器从受限 `/api/bootstrap` 自动获得仅本机使用的随机令牌。
- 公网：必须将 `site.publicOrigin` 设置为**准确的 HTTPS Origin**，例如 `https://class.example.com`，不带结尾斜杠、路径或端口以外的内容；配置随机的站点访问令牌，至少 24 字符。网页通过设置窗口提示用户输入令牌，并仅将其保存在当前标签页的 `sessionStorage`。不要将站点令牌与 ASR API Key 混用。
- 公网模式不提供 `/api/bootstrap` 令牌，也不允许浏览器修改 ASR 的服务地址和 Key；修改 ASR 配置需要编辑服务端私有文件并重启。
- 环境变量 `HOST`、`PORT`、`PUBLIC_ORIGIN`、`SITE_ACCESS_TOKEN`、`ASR_BASE_URL`、`ASR_MODEL`、`ASR_API_KEY` 优先于 JSON 中对应字段，可用于机密注入。`CLIENT_TOKEN` 可作为 `SITE_ACCESS_TOKEN` 的兼容旧名称。
- 缺少 JSON 文件时仍支持本地默认运行，但 ASR API Key 仍需由 JSON 或环境变量提供。

生成随机站点访问令牌（在部署主机执行）：`openssl rand -hex 32`。不可将 `config.json`、真实密码、录音或日志提交到 Git。

## Nginx 反向代理示例

先完成 HTTPS 证书安装。下面是已有 HTTPS `server` 块中的示例，不是完整证书配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:4189;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

反代域名应当与 `site.publicOrigin` 完全一致。浏览器经 HTTPS 访问网页，并使用同域 WSS 连接 `/ws/client`；Node.js 网关会校验浏览器的 `Origin` 和连接令牌。反代不应替用户提供可绕过认证的静态令牌或把 `/api/bootstrap` 特殊映射到 `localhost`。可叠加 Nginx 的 HTTP Basic Auth，但不能因此删除应用本身的 WebSocket 认证。

如将 `listen.host` 设置成 `0.0.0.0`，必须先设置 HTTPS `site.publicOrigin` 和强令牌，还必须自行配置防火墙阻止公众直接访问未经 TLS 加密的后端端口。**优先使用 loopback + Nginx**。

## 主项目到独立 ASR 服务

`asr.baseUrl` 必须是**主项目服务器自身能访问的地址**。如果主项目部署在俄罗斯 VPS、ASR 在 Mac mini，那么 `http://127.0.0.1:8090/v1` 指的是 VPS 自己，并不会连到 Mac。应改为具备 HTTPS 的 ASR 反代 URL，或者适当配置加密隧道。ASR API Key 只在后端发送，不进入浏览器。ASR 的原生 whisper.cpp 内部服务保持私有监听。参见 ASR 仓库配置文档。

## 运行与验证

```sh
npm ci
cp config.example.json config.json
# 编辑 config.json，配置监听、ASR 地址和公网站点认证
npm run dev
npm run typecheck
npm run build
ASR_REPO=../ru-class-asr npm test
```

公网模式测试：未输入站点令牌应无法进入录音；错误令牌无法完成 WebSocket 身份认证；正确令牌可以录音并得到真实俄语字幕。测试正常停止后最后字幕仍可见；另一个 API 客户端短暂占用 ASR 时，临时 HTTP 429 应由主项目有限重试，而不是第一次失败就停止。正式部署前还需在目标设备上实测浏览器麦克风和至少五分钟的录音。

注意：本次代码更改不等于已经完成公网部署，也不保证网络中断后保存音频。v0.1 仍不持久化完整课堂录音。
