import { Pool } from 'pg';

let pool;
export async function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : false
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS markets (
        symbol TEXT PRIMARY KEY,
        last_price DOUBLE PRECISION,
        change_pct DOUBLE PRECISION,
        volume_text TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }
  return pool;
}

export async function upsertMarkets(items) {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const x of items) {
      await client.query(
        `INSERT INTO markets (symbol, last_price, change_pct, volume_text)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (symbol) DO UPDATE
           SET last_price = EXCLUDED.last_price,
               change_pct = EXCLUDED.change_pct,
               volume_text = EXCLUDED.volume_text,
               updated_at = NOW();`,
        [x.symbol, x.lastPrice, x.changePct, x.volumeText]
      );
    }
    await client.query('COMMIT');
    return items.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}