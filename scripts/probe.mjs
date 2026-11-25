// TEMP probe (remove after review): find and test each broadcaster's own schedule source.
// From each homepage it follows the first "편성표" link and logs the data requests that page makes.
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('data/probe');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const D = new Date(Date.now() + 9 * 3600e3 + 86400e3).toISOString().slice(0, 10); // tomorrow KST
const Y = D.slice(0, 4), M = D.slice(5, 7), DD = D.slice(8, 10), YMD = Y + M + DD;

const FETCH = {
  mbn_xml: `https://www.mbn.co.kr/xml/scheduleXML.mbn?date=${Y}/${M}/${DD}`,
  ytn_m: 'https://m.ytn.co.kr/schedule.php',
};
// [key, start page, follow a 편성표 link from it?]
const PAGES = [
  ['mbc', 'https://schedule.imbc.com/', false],
  ['ebs', `https://www.ebs.co.kr/schedule?channelCd=TV&date=${YMD}&onor=TV`, false],
  ['jtbc', 'https://jtbc.co.kr/', true],
  ['jtbc2', 'https://tv.jtbc.co.kr/schedule', false],
  ['mbn', 'https://www.mbn.co.kr/', true],
  ['mbn_m', 'https://m.mbn.co.kr/tvguide/', false],
  ['channela', 'https://www.ichannela.com/', true],
  ['tvchosun', 'https://broadcast.tvchosun.com/', true],
  ['tvn', 'https://tvn.cjenm.com/ko/', true],
  ['ena', 'https://www.ena.co.kr/', true],
  ['ena2', 'https://ena.skylife.co.kr/', true],
  ['ytn', 'https://www.ytn.co.kr/', true],
  ['yonhaptv', 'https://www.yonhapnewstv.co.kr/', true],
];
const NOISE = /google|doubleclick|criteo|facebook|kakao\.com\/v|analytics|naver\.com\/wcs|scorecard|chartbeat|youtube|gstatic|\.(png|jpe?g|gif|svg|webp|css|woff2?|ttf|ico)(\?|$)/i;
const DATAISH = /sched|guide|program|epg|broad|onair|timetable|편성|\.json|\.xml|api/i;

export async function probe(browser) {
  fs.mkdirSync(OUT, {recursive: true});
  const summary = {at: new Date().toISOString(), date: D, fetch: {}, pages: {}};
  for (const [k, url] of Object.entries(FETCH)) {
    try {
      const r = await fetch(url, {headers: {'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9'}, signal: AbortSignal.timeout(20000)});
      const t = await r.text();
      fs.writeFileSync(path.join(OUT, k + '.txt'), t.slice(0, 400000));
      summary.fetch[k] = {url, status: r.status, final: r.url, type: r.headers.get('content-type'), bytes: t.length};
    } catch (e) { summary.fetch[k] = {url, error: String(e).slice(0, 200)}; }
  }
  for (const [k, url, follow] of PAGES) {
    const ctx = await browser.newContext({userAgent: UA, locale: 'ko-KR', timezoneId: 'Asia/Seoul'});
    const page = await ctx.newPage(); const reqs = [];
    page.on('request', q => { const u = q.url(); if (!NOISE.test(u) && DATAISH.test(u)) reqs.push(q.resourceType() + ' ' + q.method() + ' ' + u.slice(0, 400)); });
    const rec = {url};
    try {
      let resp = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 25000});
      rec.status = resp && resp.status();
      if (follow) {
        await page.waitForTimeout(2500);
        const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => [a.innerText.trim().slice(0, 30), a.href]).filter(([t, h]) => /편성/.test(t) || /schedule|tvguide|timetable/i.test(h)).slice(0, 10));
        rec.links = links;
        const go = links.find(([t, h]) => /편성/.test(t) && /^https?:/.test(h)) || links.find(([, h]) => /^https?:/.test(h));
        if (go) { resp = await page.goto(go[1], {waitUntil: 'domcontentloaded', timeout: 25000}); rec.followed = go[1]; rec.status2 = resp && resp.status(); }
      }
      await page.waitForTimeout(6000);
      const text = await page.evaluate(() => document.body ? document.body.innerText : '');
      fs.writeFileSync(path.join(OUT, k + '.page.txt'), text.slice(0, 60000));
      rec.final = page.url(); rec.textBytes = text.length;
    } catch (e) { rec.error = String(e).slice(0, 200); }
    rec.reqs = reqs.slice(0, 60);
    summary.pages[k] = rec;
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
}
