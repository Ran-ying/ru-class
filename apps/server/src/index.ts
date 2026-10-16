import { createGateway } from './gateway.js';
const app = createGateway({clientToken: process.env.CLIENT_TOKEN ?? '', workerToken: process.env.WORKER_TOKEN ?? '', publicOrigin: process.env.PUBLIC_ORIGIN});
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
app.server.listen(port, host, () => console.log(JSON.stringify({service: 'ru-class', version: '0.1.0', host, port})));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void app.close().then(() => process.exit(0)));
