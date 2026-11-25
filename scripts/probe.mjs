// TEMP probe (remove after review): Daum per-channel page vs Daum 종합편성 page for 채널A / MBN
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('data/probe');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
export async function probe() {
  fs.mkdirSync(OUT, {recursive: true});
  const t = new Date(Date.now() + 9 * 3600e3 + 86400e3); const md = `${t.getUTCMonth() + 1}월${t.getUTCDate()}일`;
  const Q = {channela: '채널A 편성표', mbn: 'MBN 편성표', jongpyeon: '종합편성 편성표', jongpyeon_tomorrow: md + ' 종합편성 편성표'};
  const sum = {};
  for (const [k, q] of Object.entries(Q)) {
    try { const r = await fetch('https://search.daum.net/search?w=tot&q=' + encodeURIComponent(q), {headers: {'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9'}, signal: AbortSignal.timeout(25000)});
      const x = await r.text(); fs.writeFileSync(path.join(OUT, k + '.html'), x); sum[k] = {q, status: r.status, bytes: x.length}; }
    catch (e) { sum[k] = {q, error: String(e).slice(0, 150)}; }
    await new Promise(r => setTimeout(r, 1500));
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(sum, null, 1));
}
