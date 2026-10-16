import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

type Settings = {listen?: {host?: string; port?: number}; site?: {publicOrigin?: string; accessToken?: string}; asr?: {baseUrl?: string; model?: string; apiKey?: string}};
function readSettings(path: string): Settings {
  try {
    const value: unknown = JSON.parse(readFileSync(resolve(path), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    return value as Settings;
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
export function loadConfig(path = process.env.RU_CLASS_CONFIG || 'config.json') {
  const json = readSettings(path);
  const host = stringValue(process.env.HOST ?? json.listen?.host, 'listen.host', '127.0.0.1');
  const port = Number(process.env.PORT ?? json.listen?.port ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('listen.port must be between 1 and 65535');
  const publicOrigin = stringValue(process.env.PUBLIC_ORIGIN ?? json.site?.publicOrigin, 'site.publicOrigin');
  if (publicOrigin) {
    const parsed = new URL(publicOrigin);
    if (parsed.protocol !== 'https:' || parsed.origin !== publicOrigin || parsed.username || parsed.password) throw new Error('site.publicOrigin must be an exact HTTPS origin');
  } else if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('Non-loopback listener requires a public HTTPS origin and strong site access token');
  }
  const configuredToken = stringValue(process.env.SITE_ACCESS_TOKEN ?? process.env.CLIENT_TOKEN ?? json.site?.accessToken, 'site.accessToken');
  const clientToken = configuredToken || (publicOrigin ? '' : randomBytes(32).toString('hex'));
  if (publicOrigin && clientToken.length < 24) throw new Error('Public site requires a site access token of at least 24 characters');
  return {
    host, port, publicOrigin: publicOrigin || undefined, clientToken,
    workerToken: randomBytes(32).toString('hex'),
    localBootstrap: !publicOrigin,
    asr: {
      baseUrl: stringValue(process.env.ASR_BASE_URL ?? json.asr?.baseUrl, 'asr.baseUrl', 'http://127.0.0.1:8090/v1'),
      model: stringValue(process.env.ASR_MODEL ?? json.asr?.model, 'asr.model', 'small'),
      apiKey: stringValue(process.env.ASR_API_KEY ?? json.asr?.apiKey, 'asr.apiKey')
    }
  };
}
