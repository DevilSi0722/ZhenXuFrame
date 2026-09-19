import { createHash, createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest();
export function equalSecret(a, b) { return timingSafeEqual(digest(String(a)), digest(String(b))); }
export function security(env) {
  if (!env.FRAME_PASSWORD || env.FRAME_PASSWORD.length < 16 || !env.FRAME_SECRET || env.FRAME_SECRET.length < 32) {
    throw new Error('请配置至少 16 位的 FRAME_PASSWORD 和至少 32 位的 FRAME_SECRET');
  }
  const secret = digest(env.FRAME_SECRET);
  const sign = value => createHmac('sha256', secret).update(value).digest('base64url');
  const account = digest(env.FRAME_PASSWORD).toString('hex');
  return {
    issue(now = Date.now()) {
      const body = Buffer.from(JSON.stringify({ exp: now + 7 * 86400000, account })).toString('base64url');
      return `${body}.${sign(body)}`;
    },
    verify(token, now = Date.now()) {
      try {
        const [body, signature, extra] = token.split('.');
        if (extra || !signature || !equalSecret(signature, sign(body))) return false;
        const data = JSON.parse(Buffer.from(body, 'base64url').toString());
        return data.exp > now && data.account === account;
      } catch { return false; }
    },
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', secret, iv);
      return [iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()].map(b => b.toString('base64url')).join('.');
    },
    decrypt(value) {
      const [iv, body, tail, tag] = value.split('.').map(v => Buffer.from(v, 'base64url'));
      const cipher = createDecipheriv('aes-256-gcm', secret, iv);
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(body), cipher.update(tail), cipher.final()]).toString('utf8');
    },
  };
}

export const REFERENCE_ORIGIN = 'https://frame-reference.invalid';
export const referencePattern = /^references\/[a-f0-9-]{36}\.(png|jpeg|webp)$/;
export function referencePath(value) {
  if (!value.startsWith(`${REFERENCE_ORIGIN}/`)) return null;
  const path = value.slice(REFERENCE_ORIGIN.length + 1);
  if (!referencePattern.test(path)) throw new Error('参考图标识无效');
  return path;
}
