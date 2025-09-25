import express from 'express';
import { pg } from './db.js';

export const alerts = express.Router();

// create
alerts.post('/', async (req, res) => {
  const { user_id, coin_id, vs_currency, type, value, window_minutes = 5, cooldown_sec = 300, active = true } = req.body || {};
  if (!coin_id || !vs_currency || !type || typeof value !== 'number') {
    return res.status(400).json({ error: 'coin_id, vs_currency, type, value required' });
  }
  const q = `
    insert into alerts (user_id, coin_id, vs_currency, type, value, window_minutes, cooldown_sec, active)
    values ($1,$2,$3,$4,$5,$6,$7,$8)
    returning *`;
  const { rows } = await pg.query(q, [user_id || null, coin_id, vs_currency, type, value, window_minutes, cooldown_sec, active]);
  res.status(201).json(rows[0]);
});

// list
alerts.get('/', async (_req, res) => {
  const { rows } = await pg.query('select * from alerts order by id desc limit 100');
  res.json(rows);
});
