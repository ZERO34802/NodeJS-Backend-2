create table if not exists alerts (
  id serial primary key,
  user_id text,
  coin_id text not null,
  vs_currency text not null,
  type text not null check (type in ('above','below','percent_change')),
  value numeric not null,
  window_minutes int default 5,
  cooldown_sec int default 300,
  active boolean default true,
  last_triggered_at timestamptz
);
