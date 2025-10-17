require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(__dirname));

// ---------- PostgreSQL ----------
let dbEnabled = false;
let pool;

async function initDB() {
  try {
    if (!process.env.DATABASE_URL) {
      console.warn('[DB] DATABASE_URL not set. Running in memory-only mode.');
      return;
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : false
    });

    // Create table if it doesn't exist
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
    dbEnabled = true;
    console.log('[DB] connected (PostgreSQL)');
  } catch (e) {
    console.warn('[DB] disabled:', e.message);
    dbEnabled = false;
  }
}

// ---------- Puppeteer ----------
let browser;
function findBrowserExe() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && require('fs').existsSync(envPath)) return envPath;
  // Windows-only fallbacks (local dev). Render (Linux) won’t use these.
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.find(p => require('fs').existsSync(p)) || null;
}
async function ensureBrowser() {
  if (browser) return browser;
  const execPath = findBrowserExe();
  const opts = { headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] };
  if (execPath) opts.executablePath = execPath; // local dev only
  browser = await require('puppeteer').launch(opts);
  console.log('[PUPE] started', execPath ? `(local: ${execPath})` : '(bundled Chromium)');
  return browser;
}

// ---------- Scraper (improved) ----------
async function scrapeBinanceTop(limit = 20) {
  const b = await ensureBrowser();
  const page = await b.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36');
  await page.setViewport({ width: 1440, height: 1000 });

  const urls = [
    'https://www.binance.com/en/markets/overview',
    'https://www.binance.com/en/markets'
  ];
  let loaded = false;
  for (const url of urls) {
    try {
      console.log('[NAV]', url);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(
        () => document.querySelectorAll('a[href*="/en/trade/"]').length >= 8,
        { timeout: 30000 }
      );

      // Scroll to trigger virtualization so more rows render
      await page.evaluate(async () => {
        const sleep = (t) => new Promise(r => setTimeout(r, t));
        for (let i = 0; i < 10; i++) {
          window.scrollBy(0, 800);
          await sleep(250);
        }
        window.scrollTo(0, 0);
        await sleep(300);
      });

      loaded = true;
      break;
    } catch (e) {
      console.warn('[NAV] retry:', e.message);
    }
  }
  if (!loaded) { await page.close(); throw new Error('Could not load Binance markets'); }

  const items = await page.evaluate((max) => {
    // Parse tokens like "$1.07K", "105,620", "$178.21", "59.02%"
    const parseNumberToken = (txt) => {
      if (!txt) return null;
      const t = txt.replace(/,/g, '').trim();
      const m = t.match(/-?\$?\d+(?:\.\d+)?/);
      if (!m) return null;
      let n = parseFloat(m[0].replace('$', ''));
      const suf = (t.match(/[KMBT]$/i) || [''])[0].toUpperCase();
      const mult = suf === 'K' ? 1e3 : suf === 'M' ? 1e6 : suf === 'B' ? 1e9 : suf === 'T' ? 1e12 : 1;
      return n * mult;
    };
    const parsePct = (txt) => {
      const m = (txt || '').match(/-?\d+(\.\d+)?/);
      return m ? parseFloat(m[0]) : null;
    };

    const links = Array.from(document.querySelectorAll('a[href*="/en/trade/"]'));
    const rows = [], seen = new Set();

    for (const a of links) {
      const row = a.closest('tr') || a.closest('[role="row"]') || a.parentElement?.parentElement;
      if (!row || seen.has(row)) continue;
      seen.add(row);

      const href = a.getAttribute('href') || '';
      let sym = '';
      if (href.includes('/trade/')) {
        let after = href.split('/trade/')[1] || '';
        after = after.split('?')[0] || '';
        sym = after.replace(/[_-]/g, '').toUpperCase(); // BTC_USDT -> BTCUSDT
      }
      if (!sym) sym = (a.textContent || '').trim().replace('/', '');

      // Flatten row text
      const text = (row.textContent || '').replace(/\s+/g, ' ').trim();

      // Find percent
      const pctToken = (text.match(/-?\d+(?:\.\d+)?%/) || [null])[0];

      // Number tokens (first is usually price, last is often volume)
      const numTokens = Array.from(text.matchAll(/-?\$?\d[\d,]*(?:\.\d+)?\s*[KMBT]?/gi)).map(m => m[0]);
      const priceToken = numTokens[0] || null;
      const volumeToken = numTokens.length > 1 ? numTokens[numTokens.length - 1] : null;

      rows.push({
        symbol: sym,
        lastPrice: parseNumberToken(priceToken),
        changePct: parsePct(pctToken),
        volumeText: volumeToken || ''
      });

      if (rows.length >= max) break;
    }
    return rows.filter(x => x.symbol);
  }, limit);

  await page.close();
  if (!items.length) throw new Error('No rows parsed');
  return items;
}

// ---------- Persistence ----------
let memoryCache = { items: [], updatedAt: null };

async function saveMarkets(items) {
  if (!dbEnabled) {
    memoryCache = { items, updatedAt: new Date() };
    return items.length;
  }
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

// ---------- API ----------
app.get('/health', (req, res) => res.json({ ok: true, db: dbEnabled, time: new Date().toISOString() }));

app.get('/api/markets', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '15', 10), 100);
    if (dbEnabled) {
      const { rows } = await pool.query(
        `SELECT symbol,
                last_price AS "lastPrice",
                change_pct AS "changePct",
                volume_text AS "volumeText",
                updated_at AS "updatedAt"
         FROM markets
         ORDER BY updated_at DESC
         LIMIT $1;`,
        [limit]
      );
      return res.json({ items: rows, updatedAt: new Date() });
    }
    return res.json({ items: memoryCache.items.slice(0, limit), updatedAt: memoryCache.updatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/scrape', async (req, res) => {
  try {
    const data = await scrapeBinanceTop(15);
    const n = await saveMarkets(data);
    res.json({ ok: true, saved: n });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- Cron ----------
const schedule = process.env.CRON_SCHEDULE || '*/5 * * * *';
cron.schedule(schedule, async () => {
  try {
    const data = await scrapeBinanceTop(15);
    const n = await saveMarkets(data);
    console.log(`[CRON] saved ${n} at ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    console.error('[CRON] error:', e.message);
  }
});

// ---------- Boot ----------
(async () => {
  await initDB();
  app.listen(PORT, () => console.log(`Server http://localhost:${PORT}`));
})();
process.on('SIGINT', async () => { try { await browser?.close(); } catch {} process.exit(0); });

// Add CSV export + raw JSON view for DB inspection
app.get('/api/markets.csv', async (req, res) => {
  try {
    const { items } = await (await fetch(`http://localhost:${PORT}/api/markets?limit=200`)).json();
    const header = 'symbol,lastPrice,changePct,volumeText,updatedAt\n';
    const lines = (items || []).map(r => [
      r.symbol,
      r.lastPrice ?? '',
      r.changePct ?? '',
      (r.volumeText || '').replace(/,/g,''),
      r.updatedAt || ''
    ].join(','));
    res.set('Content-Type', 'text/csv');
    res.send(header + lines.join('\n'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});