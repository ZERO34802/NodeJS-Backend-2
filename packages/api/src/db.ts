// ESM-friendly import
import { Pool } from 'pg';

export const pg = new Pool({
  connectionString: process.env.PG_URL || 'postgres://app:secret@localhost:5432/crypto'
});

pg.on('error', (e: unknown) => console.error('pg error', e));
