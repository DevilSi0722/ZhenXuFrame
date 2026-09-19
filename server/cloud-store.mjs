import { Redis } from '@upstash/redis';

// Keep the request receipt, job, payload and history index in one transaction.
// A process dying after this transaction must never trigger another paid POST.
export const CREATE_JOB = `
local existing = redis.call('GET', KEYS[1])
if existing then return existing end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SET', KEYS[3], ARGV[3])
redis.call('ZADD', KEYS[4], ARGV[4], ARGV[1])
redis.call('ZADD', KEYS[5], 0, ARGV[1])
return ARGV[1]`;
export const RELEASE_LOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
export const RATE_LIMIT = `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n`;

export function cloudStore(env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('请先在 Vercel 连接 Upstash Redis 存储');
  const redis = new Redis({ url, token });
  const prefix = env.FRAME_NAMESPACE || 'frame:v1';
  const key = name => `${prefix}:${name}`;
  return {
    getConfig: () => redis.get(key('settings')),
    setConfig: value => redis.set(key('settings'), value),
    getJob: id => redis.get(key(`job:${id}`)),
    async saveJob(job) {
      const tx = redis.multi().set(key(`job:${job.id}`), job);
      if (['completed', 'succeeded', 'failed', 'unknown'].includes(job.status)) tx.zrem(key('active'), job.id);
      else tx.zadd(key('active'), { score: job.nextPollAt || 0, member: job.id });
      await tx.exec();
    },
    getPayload: id => redis.get(key(`payload:${id}`)),
    async create(job, payload, receipt) {
      const id = await redis.eval(CREATE_JOB, [key(`receipt:${receipt}`), key(`job:${job.id}`), key(`payload:${job.id}`), key('jobs'), key('active')], [job.id, JSON.stringify(job), JSON.stringify(payload), Date.parse(job.createdAt)]);
      return id === job.id ? { created: true, job } : { created: false, job: await this.getJob(id) };
    },
    async list(offset = 0) {
      const ids = await redis.zrange(key('jobs'), Number(offset), Number(offset) + 99, { rev: true });
      return ids.length ? (await redis.mget(...ids.map(id => key(`job:${id}`)))).filter(Boolean) : [];
    },
    async active() {
      const ids = await redis.zrange(key('active'), '-inf', Date.now(), { byScore: true, offset: 0, count: 5 });
      return ids.length ? (await redis.mget(...ids.map(id => key(`job:${id}`)))).filter(Boolean) : [];
    },
    retire: id => redis.zrem(key('active'), id),
    postpone: (id, until) => redis.zadd(key('active'), { xx: true }, { score: until, member: id }),
    lock: (name, owner, seconds) => redis.set(key(`lock:${name}`), owner, { nx: true, ex: seconds }),
    unlock: (name, owner) => redis.eval(RELEASE_LOCK, [key(`lock:${name}`)], [owner]),
    async limit(name, max, seconds) { return await redis.eval(RATE_LIMIT, [key(`limit:${name}`)], [seconds]) <= max; },
  };
}
