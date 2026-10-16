import { randomBytes } from 'node:crypto';
import { createGateway } from './gateway.js';
const host=process.env.HOST||'127.0.0.1';
// Automatic local browser authentication is confined to a loopback-only listener.
if(!['127.0.0.1','localhost'].includes(host)||process.env.PUBLIC_ORIGIN)throw new Error('v0.1 API setup UI is local-only; public deployment requires separate site authentication');
const app=createGateway({clientToken:process.env.CLIENT_TOKEN||randomBytes(32).toString('hex'),workerToken:randomBytes(32).toString('hex'),localBootstrap:true,asr:{baseUrl:process.env.ASR_BASE_URL||'http://127.0.0.1:8090/v1',apiKey:process.env.ASR_API_KEY||'',model:process.env.ASR_MODEL||'small'}});
await app.probe();
const port=Number(process.env.PORT||3000);
app.server.listen(port,host,()=>console.log(JSON.stringify({service:'ru-class',version:'0.1.0',host,port,transport:'openai-compatible-asr'})));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close().then(()=>process.exit(0)));
