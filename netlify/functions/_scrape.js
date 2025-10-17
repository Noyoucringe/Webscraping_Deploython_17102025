import chromium from '@sparticuz/chrome-aws-lambda';
import puppeteer from 'puppeteer-core';

export async function scrapeBinanceTop(limit = 12) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1366, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: chromium.headless
  });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36');

  // Load and trigger virtualization render
  const urls = [
    'https://www.binance.com/en/markets/overview',
    'https://www.binance.com/en/markets'
  ];
  let ok = false;
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(
        () => document.querySelectorAll('a[href*="/en/trade/"]').length >= 6,
        { timeout: 20000 }
      );
      // small scroll to render values
      await page.evaluate(async () => {
        const sleep = (t)=>new Promise(r=>setTimeout(r,t));
        for (let i=0;i<6;i++){ window.scrollBy(0,700); await sleep(150); }
        window.scrollTo(0,0);
        await sleep(200);
      });
      ok = true;
      break;
    } catch {}
  }
  if (!ok) { await browser.close(); throw new Error('Binance page not loaded'); }

  const items = await page.evaluate((max) => {
    const parseNum = (txt) => {
      if (!txt) return null;
      const t = txt.replace(/,/g,'').trim();
      const m = t.match(/-?\$?\d+(?:\.\d+)?/);
      if (!m) return null;
      let n = parseFloat(m[0].replace('$',''));
      const suf = (t.match(/[KMBT]$/i) || [''])[0].toUpperCase();
      const mult = suf==='K'?1e3:suf==='M'?1e6:suf==='B'?1e9:suf==='T'?1e12:1;
      return n * mult;
    };
    const parsePct = (txt) => {
      const m = (txt || '').match(/-?\d+(?:\.\d+)?/);
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
        sym = after.replace(/[_-]/g,'').toUpperCase();
      }
      if (!sym) sym = (a.textContent || '').trim().replace('/', '');

      const text = (row.textContent || '').replace(/\s+/g,' ').trim();
      const pctTok = (text.match(/-?\d+(?:\.\d+)?%/) || [null])[0];
      const nums = Array.from(text.matchAll(/-?\$?\d[\d,]*(?:\.\d+)?\s*[KMBT]?/gi)).map(m=>m[0]);
      const priceTok = nums[0] || null;
      const volTok = nums.length>1 ? nums[nums.length-1] : null;

      rows.push({
        symbol: sym,
        lastPrice: parseNum(priceTok),
        changePct: parsePct(pctTok),
        volumeText: volTok || ''
      });
      if (rows.length >= max) break;
    }
    return rows.filter(x=>x.symbol);
  }, limit);

  await browser.close();
  if (!items.length) throw new Error('No rows parsed');
  return items;
}