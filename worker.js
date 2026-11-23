// ModelRadar GitHub Actions Worker (na-zz aralığı — Google Cloud ile çakışmaz)
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
  const r = await fetch(TARGET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ingest-key': INGEST_KEY },
    body: JSON.stringify({ items }),
    signal: AbortSignal.timeout(15000)
  });
  const txt = await r.text();
  console.log(`Ingest (${items.length}):`, r.status, txt);
}

(async () => {
  // Her 15 dk çalıştırmada zaman bazlı farklı 3 kapsam x 5 sayfa tarar
  const slot = Math.floor(Date.now() / (15 * 60 * 1000));
  let totalSent = 0;
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
