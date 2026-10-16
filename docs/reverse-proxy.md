# RU-Class HTTPS/WSS 反代准备（公网发布前置事项）

> **当前仍是单用户内网开发版，不应直接发布为公众可用服务。** 自 v0.1.7 起 RU-Class 不提供任何默认 ASR/文字/图像 API，`config.json` 只用于系统部署配置。公众 BYOK 必须先完成每用户鉴权/密钥隔离/会话隔离与安全出口，再启用公网部署。参见 [BYOK 公共服务架构](byok-public-service.md)。

## 仅用于系统部署的配置

```json
{
  "listen": {"host": "127.0.0.1", "port": 4189},
  "site": {
    "publicOrigin": "",
    "accessToken": ""
  }
}
```

`listen.host` 与 `listen.port` 可以自由选择。当前内网用户模式建议 loopback、不开启 `site.publicOrigin`，然后到网页里自行填写语音、图像、文字 API 地址、模型、Token。个人 API 信息只进入本地私有 `data/local-models.json`；系统 `config.json` 与 `ASR_*` 环境变量均不会提供预设 AI 服务。

如你只需在同机浏览器开发，可以直接访问 `http://127.0.0.1:4189`（浏览器麦克风需要 HTTPS 或 localhost 安全上下文）。**不应简单地把当前局域网 IP 的 HTTP 页面用于实际 iPad 麦克风采集。** 跨设备内网测试需部署受信任证书的 HTTPS/WSS 反代。

## Nginx 反代示例（供未来适配）

以下仅表示 WebSocket 必需的代理头。证书、账户、授权与 API 出站安全策略并未由这段配置提供，**不能把它当成公共多用户服务部署说明**：

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

真正发布时，还必须为每个用户提供独立身份和密钥存储机制。服务器不能直接代理来自未鉴权用户的任意 API URL，否则可能被滥用去访问内网和云元数据接口；也不能仅靠一个全站共用的 `site.accessToken` 区分用户。

## 私有 ASR 与公用 BYOK 的区别

`ru-class-asr` 是**用户自己可部署**的独立 HTTP ASR 服务。它提供的地址不是 RU-Class 的默认服务，不能让所有访问 RU-Class 网站的用户自动使用维护者的 Mac mini、VPS 或 API Key。用户只能显式填入自己可访问的、符合安全连接要求的 ASR 地址。公共服务的后端必须另外实现逐用户 API 连接与会话隔离。

## 内网迁移

运行 `git pull --ff-only`、`npm ci`、`npm run build` 并重启主项目后，打开设置手动配置一次自己的 API；以前放在主项目 `.env` 或 `config.json` 的 ASR 地址和 Key 不再被当成预设使用。不要改动独立 ASR 服务本身的内部配置。
