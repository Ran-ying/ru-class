> **HISTORICAL REVERSE PROXY CONFIGURATION (2026-10-17)**. Do not use
> `/ws/client`, server ASR credentials or legacy website access-token
> routing in the active v0.4.0 product. Serve `apps/web/` as static HTTPS
> assets, and separately expose any privately owned ASR through its own HTTPS
> endpoint if the user's browser needs remote access. See
> [current status](current-status.md) and
> [browser-direct architecture](browser-direct-byok.md).

# v0.2.0：RU-Class 不需要 API 反向代理

RU-Class 的网页与用户 API 的请求链路是**分离的**：部署 RU-Class 只需托管 `apps/web` 静态文件到 HTTPS 站点。用户浏览器直连自己的 ASR/文字/图像 API。**不要配置到 Node 的 `/ws/client` 或 `/api/asr` 的代理；这些属于旧版历史代码。**

最简 Nginx HTTPS server 块（证书和域名由部署者提供）：

```nginx
root /path/to/ru-class/apps/web;
index index.html;
location / {
    try_files $uri $uri/ =404;
}
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" always;
```

注意：公网静态资源**必须 HTTPS**，否则浏览器麦克风将被拒绝；要提供完整 JavaScript 模块及 AudioWorklet。域名证书和生产缓存策略仍需自行配置。

你的自建 ASR 与网页不同域时，在独立 ASR 服务中配置 `cors.allowedOrigins` 为真实网页 Origin（见独立仓库 README），并提供可信 HTTPS API 地址。不支持 CORS 的第三方 API 无法通过浏览器访问，**RU-Class 不提供代理**。

用户数据：API Token、模型、录音和识别文字均存于用户自己的 IndexedDB，网站服务器不接受用户数据，不要求登录或统一站点 Token。详细规范：[浏览器直连 BYOK](browser-direct-byok.md)。
