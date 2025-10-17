import { upsertMarkets } from './_db.js';
import { scrapeBinanceTop } from './_scrape.js';

export const handler = async () => {
  try {
    const items = await scrapeBinanceTop(12);  // keep runtime < 10s
    const n = await upsertMarkets(items);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, saved: n })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};