// Collects home-shopping schedules (hsmoa.com) and broadcast EPG (Daum TV schedule)
// for today and tomorrow (KST) and writes them to data/.
//   data/<date>.json    TV home shopping 7 channels + broadcast EPG
//   data/t-<date>.json  data home shopping (T-commerce) channels
//   data/index.json     list of available dates
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.resolve('data');
const KEEP_DAYS = 60;
const TV = ['nsmall', 'gsshop', 'cjmall', 'lotteimall', 'hmall', 'hnsmall', 'immall'];
const TC = ['nsmallplus', 'gsmyshop', 'cjmallplus', 'lotteonetv', 'hmallplus', 'kshop', 'kshopplus', 'bshop', 'ssgshop', 'shopnt', 'wshop'];
const MIN_TV = 80, MIN_TC = 60, MIN_EPG = 100;
// today and tomorrow are complete on hsmoa; later days fill in gradually, so they are kept with a lower bar
const AHEAD = 7, MIN_FUTURE = 20;
const near = d => d <= kst(1);
const minTvFor = d => near(d) ? MIN_TV : MIN_FUTURE;

const kst = (offsetDays = 0) => new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);
const prevDay = d => new Date(Date.parse(d + 'T00:00:00Z') - 86400e3).toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o));
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Runs inside hsmoa.com: walks the React tree and returns the decoded schedule.
const HSMOA_EXTRACT = (sites) => {
  const rootEl = document.getElementById('__next');
  const key = Object.keys(rootEl).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
  let root = rootEl[key]; while (root.return) root = root.return;
  const map = new Map(); const seen = new WeakSet();
  const visit = (v, d) => {
    if (!v || typeof v !== 'object' || d > 6 || seen.has(v)) return; seen.add(v);
    if (Array.isArray(v)) { v.forEach(x => visit(x, d + 1)); return; }
    if (v.pdid && v.start_datetime) { map.set(v.pdid + '|' + v.start_datetime, v); return; }
    for (const k of ['schedules', 'before_live', 'live', 'after_live', 'payload', 'response', 'data', 'beforeLive']) if (v[k]) visit(v[k], d + 1);
  };
  const stack = [root];
  while (stack.length) {
    const f = stack.pop(); const p = f.memoizedProps;
    if (p && typeof p === 'object') for (const k in p) { if (k !== 'children') visit(p[k], 0); }
    if (f.child) stack.push(f.child); if (f.sibling) stack.push(f.sibling);
  }
  const hm = s => (s || '').slice(11, 16);
  return [...map.values()].filter(s => sites.includes(s.tv_channel)).map(s => {
    const pi = s.price_info || {};
    const ifm = ((s.interest_free_info && s.interest_free_info.card_infos) || []).reduce((m, c) => Math.max(m, +c.period || 0), 0);
    const cd = (pi.card_discount_infos || []).map(c => c.card_name + ' ' + c.discount_rate + '%').join(', ');
    const brand = s.brand && !s.brand.startsWith('[') ? s.brand : '';
    return {
      ch: s.tv_channel, d: (s.start_datetime || '').slice(0, 10), s: hm(s.start_datetime), e: hm(s.end_datetime),
      n: s.name, b: brand, c1: s.category1 || '', c2: s.category2 || '', c3: s.category3 || '',
      p: s.price || 0, sp: s.sale_price || 0, mx: pi.max_discount_price || 0, dr: pi.total_discount_rate || 0,
      cp: (s.promotion_info && s.promotion_info.promotion_price) || 0,
      cpw: (s.promotion_info && s.promotion_info.promotion_price_word) || '',
      lp: s.launching_price || 0, cd, ifm,
      pg: (s.show_program_info && s.show_program_info.display_name) || '',
      u: s.url || '', lo: s.live_order || 0,
      // rb = the slot hsmoa says this product is (next) broadcast in; products for other slots are listed too, so this broadcast's own ones go first
      op: (s.same_time_products || []).map(x => ({ n: x.name, p: x.price || 0, sp: x.sale_price || 0, cp: (x.promotion_info && x.promotion_info.promotion_price) || 0, mx: (x.price_info && x.price_info.max_discount_price) || 0, rb: (x.recent_broadcast_start_datetime || '').slice(0, 16) }))
        .sort((a, b) => (b.rb === (s.start_datetime || '').slice(0, 16)) - (a.rb === (s.start_datetime || '').slice(0, 16))).slice(0, 10),
      opn: s.same_time_products_count || (s.same_time_products || []).length
    };
  });
};

const EPG_CH = [[9, 'KBS1', '지상파'], [7, 'KBS2', '지상파'], [11, 'MBC', '지상파'], [5, 'SBS', '지상파'], [13, 'EBS', '지상파'],
  [15, 'JTBC', '종편'], [16, 'MBN', '종편'], [18, '채널A', '종편'], [20, 'TV조선', '종편'],
  [1, 'ENA', '케이블'], [3, 'tvN', '케이블'], [23, '연합뉴스TV', '뉴스'], [24, 'YTN', '뉴스']];

function capSize(doc, limit) {
  let s = JSON.stringify(doc);
  for (const cap of [6, 4, 2, 0]) {
    if (Buffer.byteLength(s) <= limit) break;
    for (const i of doc.items) i.op = (i.op || []).slice(0, cap);
    s = JSON.stringify(doc);
  }
  return doc;
}

const HS_LOG = [];
async function hsmoaDay(page, d) {
  const minTv = minTvFor(d), tries = near(d) ? 6 : 2;
  const dd = String(+d.slice(8, 10));
  const base = `date=${dd}&time_size=24&direction=down&base_hour_datetime=${prevDay(d)}T23%3A59%3A00%2B09%3A00`;
  const urls = [
    `https://hsmoa.com/?${base.replace('&time_size', `&time=${d}T03%3A00%3A00.000Z&time_size`)}`,
    `https://hsmoa.com/?${base}`,
    `https://hsmoa.com/?${base.replace('&time_size', `&time=${encodeURIComponent(new Date().toISOString())}&time_size`)}`,
  ];
  for (let attempt = 0; attempt < tries; attempt++) {
    const url = urls[attempt % urls.length];
    try {
      await page.goto('about:blank');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // poll the page until the decoded schedule is present and stable (max ~40s)
      let items = [], last = -1;
      for (let k = 0; k < 20; k++) {
        await page.waitForTimeout(2000);
        items = (await page.evaluate(HSMOA_EXTRACT, [...TV, ...TC]).catch(() => [])).filter(i => i.d === d);
        const tvN = items.filter(i => TV.includes(i.ch)).length;
        if (tvN >= minTv && items.length === last) break;
        if (k >= 8 && items.length === last && tvN < minTv) break; // nothing more is coming for this day
        last = items.length;
      }
      HS_LOG.push(`${d} try${attempt + 1} ${items.length}`);
      if (items.filter(i => TV.includes(i.ch)).length >= minTv) return items;
    } catch (e) { HS_LOG.push(`${d} try${attempt + 1} error ${String(e.message).slice(0, 120)}`); }
    await page.waitForTimeout(3000);
  }
  return [];
}

const EPG_LOG = [];

// ---------- official channel schedules: fill what hsmoa is missing ----------
// GS SHOP and Hmall block requests from overseas servers, so only these channels are checked.
const OFFICIAL_LOG = [];
const OFFICIAL_DOWN = new Set();
const ymd = d => d.replace(/-/g, '');
const kstOf = ms => new Date(ms + 9 * 3600e3).toISOString();
const xmlTag = (blk, t) => { const m = blk.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')); return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : ''; };
const num = v => +String(v || '').replace(/[^\d]/g, '') || 0;
const firstPerSlot = list => { const seen = new Set(); return list.filter(x => x.s && x.n && !seen.has(x.d + x.s) && seen.add(x.d + x.s)); };
const OFFICIAL = {
  cjmall: async (req, d) => {
    const j = await (await req.get(`https://display.cjonstyle.com/c/rest/tv/tvSchedule?bdDt=${ymd(d)}&isMobile=false&broadType=live&isEmployee=false`, { timeout: 20000 })).json();
    return ((j.result && j.result.programList) || []).map(p => { const it = (p.itemList || [])[0] || {}; const a = kstOf(p.bdStrDtm), z = kstOf(p.bdEndDtm);
      return { d: a.slice(0, 10), s: a.slice(11, 16), e: z.slice(11, 16), n: it.itemNm || '', p: it.salePrice || 0, sp: it.hpSalePrice || 0, pg: p.pgmNm || '' }; });
  },
  immall: async (req, d) => {
    const x = await (await req.post('https://www.gongyoungshop.kr/tvshopping/selectScheduleSub.do', { form: { brcStdDate: ymd(d) }, timeout: 20000 })).text();
    return firstPerSlot([...x.matchAll(/<prdList>([\s\S]*?)<\/prdList>/g)].map(m => { const b = m[1], a = xmlTag(b, 'brcBgnDtm'), z = xmlTag(b, 'brcEndDtm');
      return { d: `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}`, s: `${a.slice(8, 10)}:${a.slice(10, 12)}`, e: `${z.slice(8, 10)}:${z.slice(10, 12)}`, n: xmlTag(b, 'prdNm'), p: num(xmlTag(b, 'prdPrc')), sp: 0, pg: xmlTag(b, 'brcPgmNm') }; }));
  },
  lotteimall: async (req, d) => {
    const j = await (await req.get(`https://www.lotteimall.com/main/scheduleLive.lotte?bdDate=${ymd(d)}&date=${d}`, { timeout: 20000 })).json();
    return firstPerSlot(((j.body && j.body.prod) || []).map(p => ({ d, s: p.stime || '', e: p.etime || '', n: p.name || '', p: num(p.price_orig) || num(p.price_disc), sp: num(p.price_disc), pg: '' })));
  },
  kshop: async (req, d) => {
    const j = await (await req.get(`https://www.kshop.co.kr/display/web/emc/display/broadcast?broadcastType=tv&dateValue=${ymd(d)}`, { timeout: 20000 })).json();
    const at = v => kstOf(Date.parse(String(v || '').replace(/\+0000$/, 'Z')));
    return firstPerSlot(((j.data && j.data.tvScheduleList) || []).map(x => { const pr = (x.productList || [])[0] || {}, ps = pr.priceSummary || {}, a = at(x.brdBgnDtm), z = at(x.brdClDtm);
      return { d: a.slice(0, 10), s: a.slice(11, 16), e: z.slice(11, 16), n: pr.prdNm || x.schdNm || '', p: ps.ecMktSlPc || 0, sp: ps.ecSlPc || 0, pg: x.schdNm || '' }; }));
  },
  nsmall: async (req, d) => {
    const j = await (await req.get(`https://mapi.nsmall.com/md/api/v1/display/media/schedule/tv/${ymd(d)}?formDate=${ymd(d)}&cnnlCd=TV`, { timeout: 20000 })).json();
    const l = (j.data && j.data.resultData && j.data.resultData.totalOrgan) || [];
    return firstPerSlot(l.map(o => { const g = o.goods || {}, a = String(o.startDtm || ''), z = String(o.endDtm || '');
      return { d: `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}`, s: `${a.slice(8, 10)}:${a.slice(10, 12)}`, e: `${z.slice(8, 10)}:${z.slice(10, 12)}`, n: (g.productNm || '').trim(), p: g.salePrice || 0, sp: g.dcPrice || 0, pg: o.pgmNm || '' }; }));
  },
};
const hmMin = hm => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
const span = x => { const a = hmMin(x.s); let z = hmMin(x.e); if (z <= a) z += 1440; return [a, z]; };
// a channel needs the official schedule only when hsmoa leaves a hole of 20+ minutes (or has nothing)
const hasGap = (items, ch) => {
  const l = items.filter(i => i.ch === ch).map(span).sort((a, b) => a[0] - b[0]);
  if (!l.length || l[l.length - 1][1] < 1440 - 20) return true;
  for (let k = 1; k < l.length; k++) if (l[k][0] - l[k - 1][1] >= 20) return true;
  return false;
};
async function fillFromOfficial(req, d, items) {
  const added = [];
  for (const [ch, fetchOfficial] of Object.entries(OFFICIAL)) {
    if (!hasGap(items, ch)) { OFFICIAL_LOG.push(`${d} ${ch} no gap`); continue; }
    let list = null;
    // a site that failed every retry earlier in this run is skipped for the remaining days
    for (let attempt = 1; attempt <= 3 && !list && !OFFICIAL_DOWN.has(ch); attempt++) {
      try { list = (await fetchOfficial(req, d)).filter(x => x.d === d && /^\d\d:\d\d$/.test(x.s) && /^\d\d:\d\d$/.test(x.e)); }
      catch (e) { OFFICIAL_LOG.push(`${d} ${ch} try${attempt} ${String(e.message).split('\n')[0].slice(0, 80)}`); await new Promise(r => setTimeout(r, 5000 * attempt)); }
    }
    const mine = items.filter(i => i.ch === ch).map(span);
    if (!list) {
      OFFICIAL_DOWN.add(ch);
      // site unreachable this run: keep what an earlier run already took from it
      const prev = ((readJson(path.join(DATA, `${d}.json`)) || {}).items || []).filter(i => i.ch === ch && i.src === 'o');
      const kept = prev.filter(o => { const [a, z] = span(o); return !mine.some(([b, y]) => Math.min(z, y) - Math.max(a, b) >= 5); });
      added.push(...kept); OFFICIAL_LOG.push(`${d} ${ch} unreachable, kept ${kept.length} from earlier run`); continue;
    }
    let n = 0;
    for (const o of list) {
      const [a, z] = span(o);
      // keep only official broadcasts that hsmoa has nothing for (less than 5 minutes of overlap)
      if (mine.some(([b, y]) => Math.min(z, y) - Math.max(a, b) >= 5)) continue;
      added.push({ ch, d, s: o.s, e: o.e, n: o.n || o.pg || '방송', b: '', c1: '', c2: '', c3: '', p: o.p || o.sp || 0, sp: o.sp && o.sp !== (o.p || o.sp) ? o.sp : 0, mx: 0, dr: 0, cp: 0, cpw: '', lp: 0, cd: '', ifm: 0, pg: o.pg || '', u: '', lo: 0, op: [], opn: 0, src: 'o' });
      n++;
    }
    OFFICIAL_LOG.push(`${d} ${ch} official ${list.length} added ${n}`);
  }
  return added;
}
// Broadcast EPG from Daum search's weekly channel schedule (reachable from overseas runners).
const DAUM_Q = {KBS1: 'KBS1', KBS2: 'KBS2', MBC: 'MBC', SBS: 'SBS', EBS: 'EBS1', JTBC: 'JTBC', MBN: 'MBN', '채널A': '채널A', 'TV조선': 'TV조선', ENA: 'ENA', tvN: 'tvN', '연합뉴스TV': '연합뉴스TV', YTN: 'YTN'};
const decodeHtml = t => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
async function daumChannel(name, year) {
  const url = 'https://search.daum.net/search?w=tot&q=' + encodeURIComponent(DAUM_Q[name] + ' 편성표');
  const r = await fetch(url, {headers: {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9'}, signal: AbortSignal.timeout(30000)});
  const t = await r.text();
  const days = {};
  for (const m of t.matchAll(/id="channelTitle(\d+)"[^>]*>\s*<span class="date">(\d{1,2})\.(\d{1,2})<\/span>/g)) {
    let y = year; const mo = +m[2];
    const nowMo = +kst(0).slice(5, 7);
    if (nowMo === 12 && mo === 1) y = year + 1; else if (nowMo === 1 && mo === 12) y = year - 1;
    days[m[1]] = `${y}-${String(mo).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
  }
  const out = {};
  for (const m of t.matchAll(/<td id="channelBody(\d+)_(\d+)"[^>]*>([\s\S]*?)<\/td>/g)) {
    const hh = String(+m[1]).padStart(2, '0'); const d = days[m[2]]; if (!d) continue;
    for (const e of m[3].matchAll(/<dt class="tit">\s*(\d+)\s*<\/dt>\s*<dd class="cont">([\s\S]*?)<\/dd>/g)) {
      const title = decodeHtml(e[2].replace(/<span class="img_tv[^"]*">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      if (!title) continue;
      (out[d] = out[d] || []).push([hh + ':' + String(+e[1]).padStart(2, '0'), title, '']);
    }
  }
  for (const d in out) out[d].sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}
// ---------- TV schedules: Daum and Naver cross-checked, broadcaster's own schedule when they disagree ----------
const EPG_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const getText = async url => {
  const r = await fetch(url, {headers: {'User-Agent': EPG_UA, 'Accept-Language': 'ko-KR,ko;q=0.9'}, signal: AbortSignal.timeout(25000)});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
};
const pad2 = n => String(+n).padStart(2, '0');
const yearFor = (year, mo) => { const nowMo = +kst(0).slice(5, 7); return nowMo === 12 && mo === 1 ? year + 1 : nowMo === 1 && mo === 12 ? year - 1 : year; };
const cleanTitle = t => decodeHtml(t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

// Naver's weekly box: <li class="item"> per hour, then one block per programme tagged with its day column
export function parseNaver(t, year) {
  const i = t.indexOf('_date_list'); if (i < 0) return {};
  const seg = t.slice(i, i + 900000);
  const cols = {};
  for (const m of seg.matchAll(/<li class="col(\d+)[^"]*">\s*<a[^>]*>\s*(\d{1,2})\.(\d{1,2})\./g)) if (!cols[m[1]]) cols[m[1]] = `${yearFor(year, +m[2])}-${pad2(m[2])}-${pad2(m[3])}`;
  const out = {};
  // the current hour's row is <li class="item _now">, so split on any item row
  for (const block of seg.split(/<li class="item[^"]*">/).slice(1)) {
    const h = (block.match(/<div class="time_box[^"]*">\s*<span>(\d{1,2})시/) || [])[1]; if (h == null) continue;
    for (const p of block.split('<div class="ind_program col').slice(1)) {
      const d = cols[(p.match(/^(\d+)/) || [])[1]]; if (!d) continue;
      // one column of an hour can hold several programmes, each with its own minute
      for (const m of p.matchAll(/<div class="time_min">\s*(\d{1,2})[\s\S]*?class="pr_title"[^>]*>([\s\S]*?)<\/(?:a|span|strong|div)>/g)) {
        const title = cleanTitle(m[2]).replace(/\((\d+)회\)$/, ' $1회'); if (title) (out[d] = out[d] || []).push([pad2(h) + ':' + pad2(m[1]), title, '']);
      }
    }
  }
  for (const d in out) out[d].sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let naverPage = null;
async function naverChannel(name, year) {
  const url = 'https://search.naver.com/search.naver?where=nexearch&query=' + encodeURIComponent(DAUM_Q[name] + ' 편성표');
  try {
    const r = await fetch(url, {headers: {'User-Agent': EPG_UA, 'Accept-Language': 'ko-KR,ko;q=0.9', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Referer': 'https://www.naver.com/'}, signal: AbortSignal.timeout(25000)});
    if (r.ok) { const out = parseNaver(await r.text(), year); if (Object.keys(out).length) return out; }
    else EPG_LOG.push('naver ' + name + ' HTTP ' + r.status + ' → browser');
  } catch (e) { EPG_LOG.push('naver ' + name + ' ' + String(e).slice(0, 80) + ' → browser'); }
  // Naver refuses bursts of plain requests; a real browser page gets the same box
  if (!naverPage) { const b = await chromium.launch(); naverPage = await (await b.newContext({locale: 'ko-KR', timezoneId: 'Asia/Seoul', userAgent: EPG_UA})).newPage(); naverPage._browser = b; }
  await naverPage.goto(url, {waitUntil: 'domcontentloaded', timeout: 30000});
  await naverPage.waitForTimeout(1500);
  return parseNaver(await naverPage.content(), year);
}

// broadcasters' own schedules, each returns [[HH:MM, title, ''], ...] for day d (YYYY-MM-DD)
// KBS, SBS, MBC, MBN and tvN publish a broadcast day (to 29:00); YTN and JTBC a calendar day
export const OFFICIAL_PARSE = {
  kbs: t => JSON.parse(t).flatMap(x => x.schedules || []).map(s => [String(s.program_planned_start_time).replace(/^(\d\d)(\d\d).*/, '$1:$2'), (s.programming_table_title || s.program_title || '').trim(), '']),
  mbc: t => JSON.parse(t.slice(t.indexOf('(') + 1, t.lastIndexOf(')'))).map(x => [x.StartTime.slice(0, 2) + ':' + x.StartTime.slice(2, 4), (x.Title || '').trim(), '']),
  jtbc: t => [...t.matchAll(/class="time_v">\s*(\d{1,2}:\d{2})[\s\S]*?<strong class="title">([\s\S]*?)<\/strong>/g)].map(m => [m[1].padStart(5, '0'), cleanTitle(m[2]), '']),
  // tvN: one response holds the week; times run past midnight within a scheDt, so wrap them to 24:xx+
  tvn: (t, d) => {
    const list = ((JSON.parse(t).result || {}).data || {}).schePgmList || [];
    const rows = []; let prev = -1;
    for (const x of list.filter(x => x.scheDt === d.replace(/-/g, '') && /tvN$/.test(x.chnNm || 'tvN'))) {
      let [h, m] = (x.bdStrTtm || '').split(':').map(Number); if (isNaN(h)) continue;
      if (h * 60 + m < prev - 600) h += 24; prev = h * 60 + m;
      rows.push([pad2(h) + ':' + pad2(m), (x.pgmEpinoNm || x.pgmNm || '').trim(), '']);
    }
    return rows;
  },
  sbs: t => JSON.parse(t).map(s => [s.start_time, (s.title || '').trim(), '']),
  mbn: (t, d) => [...t.matchAll(/<program>([\s\S]*?)<\/program>/g)].map(m => {
    const g = k => ((m[1].match(new RegExp(`<${k}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${k}>`)) || [])[1] || '').trim();
    const ep = g('bcast_episode');
    return g('air_date') === d ? [g('start_time'), decodeHtml(g('program_title')) + (ep ? ` ${ep}회` : ''), ''] : null;
  }).filter(Boolean),
  ytn: t => [...t.matchAll(/<div class="time">\s*(\d{1,2}:\d{2})\s*<\/div>[\s\S]*?<span class="title">([\s\S]*?)<\/span>/g)].map(m => [m[1].padStart(5, '0'), cleanTitle(m[2]), '']),
};
const OFFICIAL_EPG = {
  MBC: d => getText(`https://control.imbc.com/Schedule/TV?callback=cb&sDate=${ymd(d)}&sType=ALL`).then(OFFICIAL_PARSE.mbc),
  JTBC: d => getText(`https://jtbc.co.kr/schedule/jtbc/${ymd(d)}`).then(OFFICIAL_PARSE.jtbc),
  tvN: (() => { let week = null; return d => (week = week || getText('https://poc-cf-api.cjenm.com/apis/v1/tmplModul/13865?removeCacheYn=N')).then(t => OFFICIAL_PARSE.tvn(t, d)); })(),
  KBS1: d => getText(`https://static.api.kbs.co.kr/mediafactory/v1/schedule/weekly?rtype=json&local_station_code=00&channel_code=11&program_planned_date_from=${ymd(d)}&program_planned_date_to=${ymd(d)}`).then(OFFICIAL_PARSE.kbs),
  KBS2: d => getText(`https://static.api.kbs.co.kr/mediafactory/v1/schedule/weekly?rtype=json&local_station_code=00&channel_code=12&program_planned_date_from=${ymd(d)}&program_planned_date_to=${ymd(d)}`).then(OFFICIAL_PARSE.kbs),
  SBS: d => getText(`https://static.cloud.sbs.co.kr/schedule/${d.replace(/-/g, '/')}/SBS.json`).then(OFFICIAL_PARSE.sbs),
  MBN: d => getText(`https://www.mbn.co.kr/xml/scheduleXML.mbn?date=${d.replace(/-/g, '/')}`).then(t => OFFICIAL_PARSE.mbn(t, d)),
  YTN: d => getText(`https://m.ytn.co.kr/schedule.php?date=${d}`).then(OFFICIAL_PARSE.ytn),
};

const BROADCAST_DAY = new Set(['KBS1', 'KBS2', 'SBS', 'MBC', 'MBN', 'tvN']);
const officialCache = {};
const officialRaw = (name, d) => (officialCache[name + d] = officialCache[name + d] || OFFICIAL_EPG[name](d));
// the calendar day d: its own rows before midnight plus the previous broadcast day's 24:00+ rows
async function officialDay(name, d) {
  if (!BROADCAST_DAY.has(name)) return officialRaw(name, d);
  const [today, before] = await Promise.all([officialRaw(name, d), officialRaw(name, prevDay(d)).catch(() => [])]);
  const early = before.filter(r => +r[0].slice(0, 2) >= 24).map(r => [pad2(+r[0].slice(0, 2) - 24) + r[0].slice(2), r[1], r[2]]);
  return [...early, ...today.filter(r => +r[0].slice(0, 2) < 24)];
}
const sameStarts = (a, b) => a.length === b.length && a.every((r, i) => r[0] === b[i][0]);
// signs of a broken copy: two programmes at one time, or programmes cut to 10 minutes or less
const oddness = rows => rows.reduce((n, r, i) => n + (i && toMinutes(r[0]) - toMinutes(rows[i - 1][0]) <= 10 ? 1 : 0), 0);
const toMinutes = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const cleanRows = rows => rows.map(r => [r[0], String(r[1] || '').replace(/\s+/g, ' ').trim(), r[2] || '']).filter(r => /^\d\d:\d\d$/.test(r[0]) && +r[0].slice(0, 2) < 24 && r[1]).sort((a, b) => a[0].localeCompare(b[0]));
const EPG_CHECK = {};
const EPG_SOURCE = 'search.daum.net + search.naver.com cross-checked; broadcaster schedule where they differ';

async function epgDays(days) {
  const year = +kst(0).slice(0, 4);
  const daum = {}, naver = {};
  const grab = async (store, fn, name, tag) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { store[name] = await fn(name, year); return; }
      catch (e) { EPG_LOG.push(tag + ' ' + name + ' ' + attempt + ' ' + String(e).slice(0, 120)); }
    }
  };
  await Promise.all(EPG_CH.map(([, name]) => grab(daum, daumChannel, name, 'daum')));
  for (const [, name] of EPG_CH) { await grab(naver, naverChannel, name, 'naver'); await sleep(1200); }
  if (naverPage) await naverPage._browser.close().catch(() => {});
  const official = async (name, d) => {
    if (!OFFICIAL_EPG[name]) return null;
    try { const rows = cleanRows(await officialDay(name, d)); return rows.length >= 5 ? rows : null; }
    catch (e) { EPG_LOG.push('official ' + name + ' ' + d + ' ' + String(e).slice(0, 100)); return null; }
  };
  const out = {};
  for (const d of days) {
    const ch = [], check = EPG_CHECK[d] = {};
    for (const [no, name, grp] of EPG_CH) {
      const a = cleanRows((daum[name] && daum[name][d]) || []), b = cleanRows((naver[name] && naver[name][d]) || []);
      let items = a, how;
      if (!a.length && !b.length) how = 'none';
      else if (!b.length) {
        // no Naver copy: check Daum against the broadcaster instead
        const off = await official(name, d);
        if (!off) how = 'daum only';
        else if (sameStarts(a, off)) how = 'same as official';
        else { items = off; how = 'differ → official'; }
      }
      else if (!a.length) { items = b; how = 'naver only'; }
      else if (sameStarts(a, b)) how = 'same';
      else {
        const off = await official(name, d);
        if (off) { items = off; how = 'differ → official'; }
        else {
          // no official copy: keep the one with fewer broken-looking rows, Naver on a tie
          const pickDaum = oddness(a) < oddness(b);
          items = pickDaum ? a : b; how = 'differ → ' + (pickDaum ? 'daum' : 'naver');
        }
      }
      // which start times only one side had (D = Daum only, N = Naver only), to see why they disagree
      if (how.startsWith('differ') && b.length) {
        const A = new Set(a.map(r => r[0])), B = new Set(b.map(r => r[0]));
        how += ` [D ${a.filter(r => !B.has(r[0])).slice(0, 4).map(r => r[0] + ' ' + r[1].slice(0, 10)).join(', ')} | N ${b.filter(r => !A.has(r[0])).slice(0, 4).map(r => r[0] + ' ' + r[1].slice(0, 10)).join(', ')} | ${a.length}/${b.length}]`;
      }
      check[name] = how;
      ch.push({no, name, grp, items});
    }
    const n = ch.reduce((s, c) => s + c.items.length, 0);
    const differ = Object.entries(check).filter(([, v]) => v.startsWith('differ')).map(([k, v]) => k + ':' + v.slice(9));
    EPG_LOG.push(d + ' programs ' + n + (differ.length ? ' | differ ' + differ.join(' ') : ''));
    if (n >= MIN_EPG) out[d] = ch;
  }
  return out;
}

// ---------- 종편 episode notes: Daum's programme box for "채널 프로그램 N회" ----------
// one line about what an episode covers, its first airing date (a rerun shows here) and guests; no AI involved
const EP_CH = ['JTBC', 'MBN', 'TV조선', '채널A'];
const EP_FILE = () => path.join(DATA, 'episodes.json');
const EP_LOG = [];
const pageText = t => decodeHtml(t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#\d+;/g, ' ')).replace(/\s+/g, ' ');
export function parseDaumEpisode(html, ep) {
  const tx = pageText(html);
  if (/이전 회차 (?:다음 회차 )?줄거리 정보 준비 중/.test(tx)) {
    const m = tx.match(/줄거리 정보 준비 중입니다 더보기 방영일 (\d{4})\.(\d\d)\.(\d\d)\.\S* 회차 (\d+)회/);
    return m && +m[4] === ep ? {pending: true, air: `${m[1]}-${m[2]}-${m[3]}`} : null;
  }
  const m = tx.match(/이전 회차 (?:다음 회차 )?([\s\S]{5,2000}?) 더보기 방영일 (\d{4})\.(\d\d)\.(\d\d)\.\S* 회차 (\d+)회((?: 시청률 [\d.]+%)?)(?: 게스트 (.+?) (?:이전 컨텐츠보기|회차 더보기|다음 컨텐츠보기))?/);
  if (!m || +m[5] !== ep) return null;
  // the box's own headline when it has one, otherwise the synopsis' opening sentence
  const tit = pageText((html.match(/<strong class="tit_story">([\s\S]*?)<\/strong>/) || [])[1] || '').trim();
  const full = m[1].trim();
  return {line: oneLine(tit || full), air: `${m[2]}-${m[3]}-${m[4]}`, guest: (m[7] || '').trim().slice(0, 60), full: full.slice(0, 400)};
}
function oneLine(t) {
  t = t.replace(/[\u{1F300}-\u{1FAFF}☀-➿️]/gu, '').trim();
  const parts = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  let line = parts[0] || '';
  if (line.length < 12 && parts[1]) line += ' ' + parts[1];
  return line.length > 70 ? line.slice(0, 68).replace(/\s\S*$/, '') + '…' : line;
}
async function episodeNotes(epg, days) {
  const store = readJson(EP_FILE()) || {};
  const want = [];
  for (const d of days.filter(near)) for (const c of epg[d] || []) {
    if (!EP_CH.includes(c.name)) continue;
    for (const [s, t] of c.items) {
      const m = t.match(/^(.*\S)\s+(\d+)회$/); if (!m || /뉴스|news/i.test(t)) continue;
      const key = c.name + '|' + t, have = store[key];
      if (have && !have.pending) continue;
      if (have && have.pending && have.tried === nowIso().slice(0, 13)) continue;
      if (!want.some(w => w.key === key)) want.push({key, ch: c.name, title: m[1], ep: +m[2]});
    }
  }
  let found = 0;
  for (const w of want.slice(0, 120)) {
    try {
      const html = await getText('https://search.daum.net/search?w=tot&q=' + encodeURIComponent(`${w.ch} ${w.title} ${w.ep}회`));
      const note = parseDaumEpisode(html, w.ep);
      if (note) { store[w.key] = {...note, at: nowIso().slice(0, 10), tried: nowIso().slice(0, 13)}; if (!note.pending) found++; }
      else store[w.key] = {pending: true, none: true, tried: nowIso().slice(0, 13)};
    } catch (e) { EP_LOG.push(w.key + ' ' + String(e).slice(0, 80)); }
    await sleep(1200);
  }
  // keep two months of notes
  const cut = kst(-60);
  for (const [k, v] of Object.entries(store)) if ((v.at || v.tried || '').slice(0, 10) < cut) delete store[k];
  writeJson(EP_FILE(), store);
  EP_LOG.push(`asked ${Math.min(want.length, 120)}, found ${found}, stored ${Object.keys(store).length}`);
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  const days = Array.from({ length: AHEAD + 1 }, (_, i) => kst(i));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36' });
  const page = await ctx.newPage();
  const summary = { at: nowIso(), days: {}, hsLog: HS_LOG, epgLog: EPG_LOG, epgCheck: EPG_CHECK, epLog: EP_LOG, officialLog: OFFICIAL_LOG };

  const hs = {};
  for (const d of days) hs[d] = await hsmoaDay(page, d);
  // hsmoa first; official sites only for holes still open by the day before broadcast (today and tomorrow)
  for (const d of days) if (near(d) && hs[d].filter(i => TV.includes(i.ch)).length >= minTvFor(d)) hs[d] = hs[d].concat(await fillFromOfficial(ctx.request, d, hs[d]));
  await browser.close();
  const epg = await epgDays(days);
  try { await episodeNotes(epg, days); } catch (e) { EP_LOG.push('episode notes failed ' + String(e).slice(0, 120)); }

  // once a broadcast has started hsmoa points its products at their next airing, so keep the line-up captured before it aired
  const nowKst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16);
  const keepAiredLineup = (list, prev) => {
    if (!prev) return;
    const old = new Map((prev.items || []).map(i => [i.ch + '|' + i.s + '|' + i.n, i]));
    for (const i of list) {
      if (`${i.d}T${i.s}` > nowKst) continue;
      const o = old.get(i.ch + '|' + i.s + '|' + i.n);
      if (o && (o.op || []).some(x => x.rb)) { i.op = o.op; i.opn = o.opn; }
    }
  };
  for (const d of days) {
    const items = hs[d].sort((a, b) => (a.s + a.ch).localeCompare(b.s + b.ch));
    const tv = items.filter(i => TV.includes(i.ch));
    const tc = items.filter(i => TC.includes(i.ch));
    const tvFile = path.join(DATA, `${d}.json`), tcFile = path.join(DATA, `t-${d}.json`);
    const prevTv = readJson(tvFile);
    const res = { tv: tv.length, tc: tc.length, epg: !!epg[d] };

    const prevTc = readJson(tcFile);
    keepAiredLineup(tv, prevTv); keepAiredLineup(tc, prevTc);
    // a later day may only be partly published: never replace a fuller earlier copy with a much thinner one
    const enough = (n, min, prev) => near(d) ? n >= min : n >= MIN_FUTURE && (!prev || n >= 0.7 * (prev.items || []).length);
    if (enough(tv.length, MIN_TV, prevTv)) {
      const doc = capSize({ date: d, collectedAt: nowIso(), source: 'hsmoa.com + official (cjmall, immall, lotteimall, nsmall) for missing slots', items: tv }, 200000);
      if (epg[d]) { doc.epg = epg[d]; doc.epgSource = EPG_SOURCE; doc.epgAt = nowIso(); }
      else if (prevTv && prevTv.epg) { doc.epg = prevTv.epg; doc.epgSource = prevTv.epgSource; doc.epgAt = prevTv.epgAt; }
      writeJson(tvFile, doc); res.tvSaved = true;
    } else if (prevTv && epg[d]) {
      prevTv.epg = epg[d]; prevTv.epgSource = EPG_SOURCE; prevTv.epgAt = nowIso(); writeJson(tvFile, prevTv);
    }
    if (enough(tc.length, MIN_TC, prevTc)) {
      writeJson(tcFile, capSize({ date: d, collectedAt: nowIso(), source: 'hsmoa.com', set: 'tcommerce', items: tc }, 220000));
      res.tcSaved = true;
    }
    summary.days[d] = res;
  }

  // index + retention
  const files = fs.readdirSync(DATA);
  const dates = [...new Set(files.map(f => (f.match(/^(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]).filter(Boolean))].sort().reverse();
  const keep = new Set(dates.slice(0, KEEP_DAYS));
  for (const f of files) {
    const m = f.match(/^(?:t-)?(\d{4}-\d{2}-\d{2})\.json$/);
    if (m && !keep.has(m[1])) fs.unlinkSync(path.join(DATA, f));
  }
  const tdates = fs.readdirSync(DATA).map(f => (f.match(/^t-(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]).filter(Boolean).sort().reverse();
  writeJson(path.join(DATA, 'index.json'), { dates: [...keep].sort().reverse(), tdates, updatedAt: nowIso(), last: summary });
  log('summary', JSON.stringify(summary));
  const ok = Object.values(summary.days).some(r => r.tvSaved);
  if (!ok) { console.error('No TV data saved this run'); process.exitCode = 1; }
}

main().catch(e => { console.error(e); process.exit(1); });
