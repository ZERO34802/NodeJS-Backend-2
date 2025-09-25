// Use the CJS default export explicitly for NodeNext
import RedisPkg from 'ioredis';
import { env } from './env.js';

const Redis = (RedisPkg as unknown as typeof import('ioredis')).default || (RedisPkg as any);

const REDIS_URL = env.REDIS_URL || 'redis://localhost:6379';

export const pub = new (Redis as any)(REDIS_URL);
export const sub = new (Redis as any)(REDIS_URL);

sub.on('error', (e: unknown) => console.error('redis sub error', e));
pub.on('error', (e: unknown) => console.error('redis pub error', e));
