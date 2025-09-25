import express from 'express';
import cors from 'cors';
import RedisPkg from 'ioredis';
import { alerts } from './alerts.js';


const Redis = (RedisPkg as any).default || (RedisPkg as any);

const PORT = parseInt(process.env.PORT || '3000', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// SSE
type Client = { id: string; res: express.Response };
const clients = new Map<string, Client>();

function sse(req: express.Request, res: express.Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const id = Math.random().toString(36).slice(2);
  clients.set(id, { id, res });
  req.on('close', () => clients.delete(id));
}

const sub = new Redis(REDIS_URL);
sub.subscribe('prices.global', 'alerts.global').catch(console.error);
sub.on('message', (_ch: string, msg: string) => {
  const payload = `data: ${msg}\n\n`;
  for (const c of clients.values()) c.res.write(payload);
});

const app = express();
app.use(cors());
app.use(express.json());

app.use('/alerts', alerts);


app.get('/stream', sse);

app.get('/prices', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  const vs = String(req.query.vs || 'usd');
  if (ids.length === 0) return res.status(400).json({ error: 'ids required' });

  const redis = new Redis(REDIS_URL);
  const pipeline = redis.pipeline();
  ids.forEach((id: string) => pipeline.hgetall(`price:${id}:${vs}`));
  const results = await pipeline.exec();
  await redis.quit();

  const out: Record<string, { [k: string]: number } & { ts: number }> = {};
  results?.forEach((entry: [Error | null, any] | null, i: number) => {
    if (!entry) return;
    const [, val] = entry;
    const v = val as Record<string, string>;
    if (v?.price && v?.ts) {
      out[ids[i] as string] = { [vs]: Number(v.price), ts: Number(v.ts) };
    }
  });

  res.json({ data: out, source: 'cache' });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`API listening on :${PORT}`));
