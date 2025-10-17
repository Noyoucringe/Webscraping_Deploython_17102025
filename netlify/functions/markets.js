import { getPool } from './_db.js';

export const handler = async () => {
  try {
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT symbol,
              last_price AS "lastPrice",
              change_pct AS "changePct",
              volume_text AS "volumeText",
              updated_at AS "updatedAt"
       FROM markets
       ORDER BY updated_at DESC
       LIMIT 50;`
    );
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: rows, updatedAt: new Date() })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};