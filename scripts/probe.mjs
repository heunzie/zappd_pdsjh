// TEMP probe (remove after review): can the collector reach Naver's schedule search and the broadcasters' own schedule pages?
// Saves what each page returns to data/probe/ so it can be inspected offline.
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('data/probe');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const D = (() => { const t = new Date(Date.now() + 9 * 3600e3 + 86400e3); return t.toISOString().slice(0, 10); })(); // tomorrow KST
const Y = D.slice(0, 4), M = D.slice(5, 7), DD = D.slice(8, 10), YMD = Y + M + DD;

// plain HTTP requests (APIs and static pages)
const FETCH = {
  naver_mbn: 'https://search.naver.com/search.naver?query=' + encodeURIComponent('MBN 편성표'),
  naver_mbn_m: 'https://m.search.naver.com/search.naver?query=' + encodeURIComponent('MBN 편성표'),
  kbs1_api: `https://static.api.kbs.co.kr/mediafactory/v1/schedule/weekly?rtype=json&local_station_code=00&channel_code=11&program_planned_date_from=${YMD}&program_planned_date_to=${YMD}`,
  kbs2_api: `https://static.api.kbs.co.kr/mediafactory/v1/schedule/weekly?rtype=json&local_station_code=00&channel_code=12&program_planned_date_from=${YMD}&program_planned_date_to=${YMD}`,
  sbs_json: `https://static.cloud.sbs.co.kr/schedule/${Y}/${M}/${DD}/SBS.json`,
  mbc_ctl: `https://control.imbc.com/Schedule/PCONTENT?sDate=${YMD}&sType=TV`,
};
// pages opened in a browser; XHR/fetch requests are logged to find each site's schedule API
const PAGES = {
  naver_mbn_page: 'https://search.naver.com/search.naver?query=' + encodeURIComponent('MBN 편성표'),
  kbs: 'https://schedule.kbs.co.kr/index.html?source=episode&sname=schedule&stype=table&ch_code=11',
  mbc: 'https://schedule.imbc.com/',
  sbs: 'https://www.sbs.co.kr/schedule/index.html',
  ebs: `https://www.ebs.co.kr/schedule?channelCd=TV&date=${YMD}&onor=TV`,
  jtbc: 'https://tv.jtbc.co.kr/schedule',
  mbn: 'https://www.mbn.co.kr/vod/programSchedule',
  channela: 'https://www.ichannela.com/broad/schedule',
  tvchosun: 'https://broadcast.tvchosun.com/broadcast/schedule.cstv',
  tvn: 'https://tvn.cjenm.com/ko/schedule/',
  ena: 'https://www.enatv.com/',
  ytn: 'https://www.ytn.co.kr/',
  yonhaptv: 'https://www.yonhapnewstv.co.kr/',
};

export async function probe(browser) {
  fs.mkdirSync(OUT, {recursive: true});
  const summary = {at: new Date().toISOString(), date: D, fetch: {}, pages: {}};
  await Promise.all(Object.entries(FETCH).map(async ([k, url]) => {
    try {
      const r = await fetch(url, {headers: {'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9'}, signal: AbortSignal.timeout(20000)});
      const t = await r.text();
      fs.writeFileSync(path.join(OUT, k + '.txt'), t.slice(0, 600000));
      summary.fetch[k] = {url, status: r.status, final: r.url, type: r.headers.get('content-type'), bytes: t.length, hasMBNshow: /굿모닝 MBN|나의 해방일지/.test(t)};
    } catch (e) { summary.fetch[k] = {url, error: String(e).slice(0, 200)}; }
  }));
  for (const [k, url] of Object.entries(PAGES)) {
    const ctx = await browser.newContext({userAgent: UA, locale: 'ko-KR'});
    const page = await ctx.newPage(); const reqs = [];
    page.on('request', q => { const t = q.resourceType(); if (t === 'xhr' || t === 'fetch' || t === 'document') reqs.push(q.method() + ' ' + q.url().slice(0, 300)); });
    try {
      const resp = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 25000});
      await page.waitForTimeout(5000);
      const text = await page.evaluate(() => document.body ? document.body.innerText : '');
      fs.writeFileSync(path.join(OUT, k + '.page.txt'), text.slice(0, 60000));
      summary.pages[k] = {url, status: resp && resp.status(), final: page.url(), textBytes: text.length, reqs: reqs.slice(0, 80)};
    } catch (e) { summary.pages[k] = {url, error: String(e).slice(0, 200), reqs: reqs.slice(0, 40)}; }
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
}
