const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// ModelRadar GitHub Actions Worker (MakerWorld + na-zz aralığı — Google Cloud ile çakışmaz)
const TARGET_URL = process.env.INGEST_URL || 'http://35.225.124.42/api/ingest';
const INGEST_KEY = process.env.INGEST_KEY || 'mr_ingest_makdesign_2026_x9k2';
const CULTS_USER = process.env.CULTS_USER || '';
const CULTS_KEY = process.env.CULTS_KEY || '';

const ALPHA_SECOND_HALF = 'nopqrstuvwxyz';
const ALPHA_ALL = 'abcdefghijklmnopqrstuvwxyz';
const SCOPES = [];
for (const a of ALPHA_SECOND_HALF) {
  for (const b of ALPHA_ALL) {
    SCOPES.push(a + b);
  }
}

async function fetchPrintables(query, page = 1) {
  try {
    const offset = (page - 1) * 48;
    const r = await fetch('https://api.printables.com/graphql/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query Search($q: String!, $limit: Int!, $offset: Int!) {
          searchPrints2(query: $q, limit: $limit, offset: $offset) {
            items { id name slug image { filePath } user { publicUsername } }
          }
        }`,
        variables: { q: query, limit: 48, offset }
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return [];
    const d = await r.json();
    const items = d?.data?.searchPrints2?.items || [];
    return items
      .filter(it => it.id && it.name && it.image?.filePath)
      .map(it => ({
        id: `pr-${it.id}`,
        title: it.name.slice(0, 120),
        platform: 'Printables',
        creator: it.user?.publicUsername || 'Printables',
        thumbnail: `https://media.printables.com/${it.image.filePath}`,
        model_url: `https://www.printables.com/model/${it.id}-${it.slug || 'model'}`,
        query_tag: query,
        price: 'Ücretsiz',
        format: 'STL / 3MF',
        is_featured: 0
      }));
  } catch { return []; }
}

async function fetchCults(query, page = 1) {
  if (!CULTS_USER || !CULTS_KEY) return [];
  try {
    const offset = (page - 1) * 40;
    const auth = Buffer.from(`${CULTS_USER}:${CULTS_KEY}`).toString('base64');
    const r = await fetch('https://cults3d.com/graphql', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ creationsSearchBatch(query: ${JSON.stringify(query)}, limit: 40, offset: ${offset}) { results { name url illustrationImageUrl price { cents currency } creator { nick } } } }`
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return [];
    const d = await r.json();
    const items = d?.data?.creationsSearchBatch?.results || [];
    return items
      .filter(it => it.name && it.url && it.illustrationImageUrl)
      .map((it, i) => ({
        id: `cu-gh-${Buffer.from(it.url).toString('base64').slice(-16)}`,
        title: it.name.slice(0, 120),
        platform: 'Cults3D',
        creator: it.creator?.nick || 'Cults3D',
        thumbnail: it.illustrationImageUrl,
        model_url: it.url,
        query_tag: query,
        price: !it.price || it.price.cents === 0 ? 'Ücretsiz' : `${(it.price.cents / 100).toFixed(2)} ${it.price.currency || 'EUR'}`,
        format: 'STL / 3MF',
        is_featured: 0
      }));
  } catch { return []; }
}

async function sendBatch(items) {
  if (!items.length) return;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(TARGET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ingest-key': INGEST_KEY },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(30000)
      });
      const txt = await r.text();
      console.log(`Ingest (${items.length}):`, r.status, txt);
      return;
    } catch (e) {
      console.log(`Ingest attempt ${attempt} failed:`, e.message);
      if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function fetchMakerWorld(browser, query) {
  let page = null;
  try {
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    const url = query
      ? `https://makerworld.com/en/search/models?keyword=${encodeURIComponent(query)}`
      : `https://makerworld.com/en/3d-models`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(r => setTimeout(r, 3500));
    for (let s = 0; s < 4; s++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 1200));
    }
    const items = await page.evaluate((q) => {
      const res = [];
      document.querySelectorAll('a[href*="/models/"]').forEach((a) => {
        if (res.length >= 40) return;
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/models\/(\d+)/);
        if (!m) return;
        const img = a.querySelector('img') || a.closest('div')?.querySelector('img');
        const thumb = img?.getAttribute('src') || img?.getAttribute('data-src') || '';
        const title = (a.getAttribute('title') || img?.getAttribute('alt') || a.innerText || '').trim().split('\n')[0];
        if (title && thumb && title.length > 2) {
          const fullUrl = href.startsWith('http') ? href : `https://makerworld.com${href}`;
          if (!res.some(x => x.model_url === fullUrl)) {
            res.push({
              id: `mw-${m[1]}`,
              title: title.slice(0, 120),
              platform: 'MakerWorld',
              creator: 'MakerWorld',
              thumbnail: thumb,
              model_url: fullUrl,
              query_tag: q,
              price: 'Ücretsiz',
              format: 'STL / 3MF',
              is_featured: 0
            });
          }
        }
      });
      return res;
    }, query);
    return items;
  } catch (e) {
    console.log('MakerWorld err:', e.message);
    return [];
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

(async () => {
  const slot = Math.floor(Date.now() / (15 * 60 * 1000));
  let totalSent = 0;

  // 1. MakerWorld (GitHub 7GB RAM ile güçlü tarama — genel akış + 5 farklı kapsam)
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const mwQueries = ['', ...Array.from({ length: 5 }, (_, i) => SCOPES[(slot * 5 + i) % SCOPES.length])];
    for (const mq of mwQueries) {
      const mwItems = await fetchMakerWorld(browser, mq);
      console.log(`MakerWorld "${mq || 'Genel'}": ${mwItems.length}`);
      if (mwItems.length > 0) {
        await sendBatch(mwItems);
        totalSent += mwItems.length;
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // 2. Printables + Cults3D (na-zz aralığı)
  for (let s = 0; s < 3; s++) {
    const scope = SCOPES[(slot * 3 + s) % SCOPES.length];
    for (let page = 1; page <= 5; page++) {
      const pr = await fetchPrintables(scope, page);
      const cu = page === 1 ? await fetchCults(scope, 1) : [];
      const batch = [...pr, ...cu];
      if (batch.length > 0) {
        await sendBatch(batch);
        totalSent += batch.length;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.log('Tamamlandi. Toplam gonderilen:', totalSent);
})();
