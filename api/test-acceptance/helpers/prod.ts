/* eslint-disable */
// Start-up guard helpers shared by the step 4 configuration scenarios (mirrors config.acc.test.ts).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TEST_DATABASE_URL } from './env.js';
import { REPO } from './sh.js';

export const b64 = () => randomBytes(48).toString('base64');
export const prodEnv = (): Record<string, string> => ({
  NODE_ENV: 'production',
  DATABASE_URL: `${TEST_DATABASE_URL}?sslmode=require`,
  APP_ORIGIN: 'https://app.example.test',
  JWT_SECRET: b64(),
  CSRF_SECRET: b64(),
  REFRESH_PEPPER: b64(),
  MFA_ENC_KEY: randomBytes(32).toString('base64'),
  API_KEY_PEPPER: b64(),
  COOKIE_SECURE: 'true',
  MAIL_TRANSPORT: 'ses',
  REDIS_URL: 'redis://127.0.0.1:6399/0',
  ENABLE_DEV_OUTBOX: 'false',
  RATE_LIMIT_ENABLED: 'true',
  ARGON2_MEMORY_KIB: '19456',
  LOCKOUT_THRESHOLD: '5',
  TRUST_PROXY: '',
  LOG_LEVEL: 'silent',
});
/** Resolves to the start-up error (or null when the app started; the app is closed again). */
export async function startupError(env: Record<string, string>): Promise<Error | null> {
  const mod: any = await import('../../src/app.js');
  try {
    const app = await Promise.race([mod.buildApp(env), new Promise((_, rej) => setTimeout(() => rej(new Error('__TIMEOUT__')), 20000))]);
    await (app as any).close?.();
    return null;
  } catch (e) {
    return e as Error;
  }
}
/** Documented public dev/CI defaults for a variable (compose.web.yml, web-ci.yml, .env.example non-placeholders). */
export function devDefaults(name: string): string[] {
  const out: string[] = [];
  const read = (p: string) => (existsSync(resolve(REPO, p)) ? readFileSync(resolve(REPO, p), 'utf8') : '');
  const compose = new RegExp(`${name}:\\s*\\$\\{${name}:-([^}]+)\\}`).exec(read('compose.web.yml'));
  if (compose) out.push(compose[1]!.trim());
  const ci = new RegExp(`^\\s*${name}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm').exec(read('.github/workflows/web-ci.yml'));
  if (ci) out.push(ci[1]!.trim());
  for (const p of ['.env.example', 'api/.env.example']) {
    const m = new RegExp(`^${name}=(.+)$`, 'm').exec(read(p));
    if (m && !m[1]!.trim().startsWith('<')) out.push(m[1]!.trim().replace(/^["']|["']$/g, ''));
  }
  return out.filter((v) => v.length >= 10);
}
