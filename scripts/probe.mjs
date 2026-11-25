// TEMP probe (remove after review): raw schedule formats of MBC, 채널A, tvN, JTBC
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('data/probe');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const D = new Date(Date.now() + 9 * 3600e3 + 86400e3).toISOString().slice(0, 10), YMD = D.replace(/-/g, '');
const NOISE = /google|doubleclick|criteo|facebook|analytics|growthbook|sidetalk|id5-sync|dable|openx|\.(png|jpe?g|gif|svg|webp|css|woff2?|ttf|ico)(\?|$)/i;
export async function probe(browser) {
  fs.mkdirSync(OUT, {recursive: true});
  const sum = {date: D, fetch: {}, pages: {}};
  for (const [k, url] of Object.entries({
    mbc: `https://control.imbc.com/Schedule/TV?callback=cb&sDate=${YMD}&sType=ALL`,
    channela: 'https://ichannela.com/com/cmm/schedule.do',
  })) {
    try { const r = await fetch(url, {headers: {'User-Agent': UA}, signal: AbortSignal.timeout(20000)}); const t = await r.text(); fs.writeFileSync(path.join(OUT, k + '.raw.txt'), t.slice(0, 500000)); sum.fetch[k] = {status: r.status, bytes: t.length}; }
    catch (e) { sum.fetch[k] = {error: String(e).slice(0, 150)}; }
  }
  for (const [k, url, clickNext] of [['channela', 'https://ichannela.com/com/cmm/schedule.do', true], ['tvn', 'https://tvn.cjenm.com/ko/tvn-schedule/', true], ['jtbc', 'https://jtbc.co.kr/schedule', true]]) {
    const ctx = await browser.newContext({userAgent: UA, locale: 'ko-KR', timezoneId: 'Asia/Seoul'});
    const page = await ctx.newPage(); const reqs = []; let saved = 0;
    page.on('request', q => { const u = q.url(); if (!NOISE.test(u) && /xhr|fetch|document/.test(q.resourceType())) reqs.push(q.method() + ' ' + u.slice(0, 400) + (q.postData() ? ' BODY ' + q.postData().slice(0, 200) : '')); });
    page.on('response', async r => {
      try { if (!/xhr|fetch/.test(r.request().resourceType()) || NOISE.test(r.url()) || saved >= 12) return;
        const t = await r.text(); if (/\d\d:\d\d|startTime|start_time|brdc|schd/i.test(t)) fs.writeFileSync(path.join(OUT, `${k}.resp${saved++}.txt`), r.url() + '\n' + t.slice(0, 300000)); } catch (e) {}
    });
    const rec = {};
    try {
      await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 25000}); await page.waitForTimeout(5000);
      if (clickNext) { const md = D.slice(5).replace('-', '.'); const day = String(+D.slice(8)); const el = await page.$(`text=${md}`) || await page.$(`text=/^\\s*${day}\\s*$/`); if (el) { await el.click().catch(() => {}); rec.clicked = true; await page.waitForTimeout(4000); } }
      fs.writeFileSync(path.join(OUT, k + '.page.txt'), (await page.evaluate(() => document.body.innerText)).slice(0, 40000));
      fs.writeFileSync(path.join(OUT, k + '.page.html'), (await page.content()).slice(0, 400000));
      rec.final = page.url();
    } catch (e) { rec.error = String(e).slice(0, 150); }
    rec.reqs = reqs.slice(0, 50); sum.pages[k] = rec; await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(sum, null, 1));
}
