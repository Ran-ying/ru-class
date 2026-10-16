import { createGateway } from './gateway.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createGateway(config);
await app.probe();
app.server.listen(config.port, config.host, () => console.log(JSON.stringify({
  service: 'ru-class', version: '0.1.4', host: config.host, port: config.port,
  mode: config.publicOrigin ? 'reverse-proxy' : 'local', transport: 'openai-compatible-asr'
})));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void app.close().then(() => process.exit(0)));
