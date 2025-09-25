import express from "express";
import { pg } from "./db.js";
import { z } from "zod";

export const alerts = express.Router();

const Coins = ["bitcoin","ethereum","solana"] as const;
const Vs = ["usd"] as const;
const Types = [">","<"] as const;

const createSchema = z.object({
  user_id: z.number().int().optional().nullable(),
  coin_id: z.enum(Coins, { invalid_type_error: "coin_id must be one of bitcoin, ethereum, solana" }),
  vs_currency: z.enum(Vs, { invalid_type_error: "vs_currency must be usd" }),
  type: z.enum(Types, { invalid_type_error: "type must be '>' or '<'" }),
  value: z.number().positive(),
  window_minutes: z.number().int().positive().max(1440).optional().default(5),
  cooldown_sec: z.number().int().positive().max(86400).optional().default(300),
  active: z.boolean().optional().default(true),
});

// create
alerts.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { user_id=null, coin_id, vs_currency, type, value, window_minutes, cooldown_sec, active } = parsed.data;
  const q = `
    insert into alerts (user_id, coin_id, vs_currency, type, value, window_minutes, cooldown_sec, active)
    values ($1,$2,$3,$4,$5,$6,$7,$8)
    returning *`;
  const { rows } = await pg.query(q, [user_id, coin_id, vs_currency, type, value, window_minutes, cooldown_sec, active]);
  res.status(201).json(rows[0]);
});

// list
alerts.get("/", async (_req, res) => {
  const { rows } = await pg.query("select * from alerts order by id desc limit 100");
  res.json(rows);
});

// toggle active
alerts.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid id" });
  const { rows } = await pg.query("update alerts set active = not active where id = $1 returning *", [id]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

// delete
alerts.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid id" });
  const { rowCount } = await pg.query("delete from alerts where id = $1", [id]);
  if (!rowCount) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});
