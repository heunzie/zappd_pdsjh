// TEMP test (remove after review): what do Naver / Daum show for "프로그램 N회" searches?
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const EPS = ['TV조선 질병의 법칙 129회', 'MBN 바디인사이트 56회', '채널A 아모르바디 54회', 'JTBC 이토록 위대한 몸 15회', 'MBN 보부상 44회'];
const out = {}; fs.mkdirSync('data/probe/search', {recursive: true});
let n = 0;
for (const q of EPS) {
  for (const [site, url] of [['naver', 'https://search.naver.com/search.naver?where=nexearch&query='], ['daum', 'https://search.daum.net/search?w=tot&q=']]) {
    const k = `${site}${n}`;
    try {
      const r = await fetch(url + encodeURIComponent(q), {headers: {'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', 'Accept': 'text/html', 'Referer': site === 'naver' ? 'https://www.naver.com/' : 'https://www.daum.net/'}, signal: AbortSignal.timeout(25000)});
      const t = await r.text(); fs.writeFileSync(`data/probe/search/${k}.html`, t);
      out[k] = {q, status: r.status, bytes: t.length};
    } catch (e) { out[k] = {q, error: String(e).slice(0, 150)}; }
    await new Promise(r => setTimeout(r, 2500));
  }
  n++;
}
fs.writeFileSync('data/probe/search/summary.json', JSON.stringify(out, null, 1));
