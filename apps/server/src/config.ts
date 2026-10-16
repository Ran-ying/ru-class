import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { emptyAccount, type Accounts, type ModelAccount } from './model-settings.js';

type Settings = {listen?: {host?: string; port?: number}; site?: {publicOrigin?: string; accessToken?: string}};
function readObject(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(resolve(path), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
    return value as Record<string, unknown>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error('Invalid config file ' + path + ': ' + String(e));
  }
}
function stringValue(value: unknown, name: string, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value !== 'string') throw new Error(name + ' must be a string');
  return value;
}
function readLocalAccounts(path: string): Accounts {
  const raw=readObject(path);
  const models=raw.models && typeof raw.models==='object' && !Array.isArray(raw.models)
    ? raw.models as Record<string, unknown> : {};
  const readAccount=(kind:keyof Accounts):ModelAccount=>{
    const candidate=models[kind];
    if(!candidate || typeof candidate!=='object'||Array.isArray(candidate))return emptyAccount();
    const item=candidate as Record<string,unknown>;
    return {
      baseUrl:stringValue(item.baseUrl,'models.'+kind+'.baseUrl'),
      model:stringValue(item.model,'models.'+kind+'.model'),
      apiKey:stringValue(item.apiKey,'models.'+kind+'.apiKey')
    };
  };
  return {speech:readAccount('speech'),image:readAccount('image'),text:readAccount('text')};
}
export function loadConfig(path = process.env.RU_CLASS_CONFIG || 'config.json') {
  // Deployment config contains ONLY server settings. Provider API information
  // belongs to the user's profile; the following file is a single-user
  // LOCAL-DEVELOPMENT bridge and must never be shared between public users.
  const json=readObject(path) as Settings;
  const host=stringValue(process.env.HOST ?? json.listen?.host, 'listen.host', '127.0.0.1');
  const port=Number(process.env.PORT ?? json.listen?.port ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('listen.port must be between 1 and 65535');
  const publicOrigin=stringValue(process.env.PUBLIC_ORIGIN ?? json.site?.publicOrigin, 'site.publicOrigin');
  if (publicOrigin) {
    const parsed=new URL(publicOrigin);
    if (parsed.protocol!=='https:' || parsed.origin!==publicOrigin || parsed.username || parsed.password) throw new Error('site.publicOrigin must be an exact HTTPS origin');
  } else if (!['127.0.0.1','localhost','::1'].includes(host)) {
    throw new Error('Non-loopback listener requires a public HTTPS origin and strong site access token');
  }
  const configuredToken=stringValue(process.env.SITE_ACCESS_TOKEN ?? process.env.CLIENT_TOKEN ?? json.site?.accessToken,'site.accessToken');
  const clientToken=configuredToken || (publicOrigin ? '' : randomBytes(32).toString('hex'));
  if (publicOrigin && clientToken.length<24) throw new Error('Public site requires a site access token of at least 24 characters');
  const localModelPath=resolve(process.env.RU_CLASS_LOCAL_MODELS_PATH||'data/local-models.json');
  // Public user accounts and credential isolation are not implemented yet.
  // Never preload a private/local user's provider secrets into a public server.
  const accounts=publicOrigin?{speech:emptyAccount(),image:emptyAccount(),text:emptyAccount()}:readLocalAccounts(localModelPath);
  const speech=accounts.speech;
  return {
    host,port,publicOrigin:publicOrigin||undefined,clientToken,
    workerToken:randomBytes(32).toString('hex'),
    localBootstrap:!publicOrigin,
    configPath:localModelPath,
    modelSettings:{image:accounts.image,text:accounts.text},
    asr:speech.baseUrl && speech.model && speech.apiKey ? speech : undefined
  };
}
