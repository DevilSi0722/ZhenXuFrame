import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest();
export function equalSecret(a, b) { return timingSafeEqual(digest(String(a)), digest(String(b))); }
export function security(env) {
  if (!env.FRAME_PASSWORD || env.FRAME_PASSWORD.length < 16) throw new Error('请配置至少 16 位的 FRAME_PASSWORD 工作台密码');
  if (env.FRAME_SECRET && env.FRAME_SECRET.length < 32) throw new Error('FRAME_SECRET 如有设置，需至少 32 位');
  const secret = digest(env.FRAME_SECRET || `frame-session-v2:${env.FRAME_PASSWORD}`);
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
  };
}
