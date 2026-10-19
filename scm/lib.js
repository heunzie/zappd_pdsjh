// Shared by the page (index.html) and the build/test scripts (node).
// Classification: hsmoa category -> our 대분류 (dict/categories.csv), product-name keywords -> 상품군 (dict/groups.csv).
// Matching: an NS broadcast vs. a competitor broadcast -> how alike they are (MODEL > SAME > SIMILAR > BRAND > GROUP).

export const CHANNELS = [
  {id: 'nsmall', name: 'NS홈쇼핑', grp: 'tv', ns: true}, {id: 'gsshop', name: 'GS샵', grp: 'tv'}, {id: 'cjmall', name: 'CJ온스타일', grp: 'tv'},
  {id: 'lotteimall', name: '롯데홈쇼핑', grp: 'tv'}, {id: 'hmall', name: '현대홈쇼핑', grp: 'tv'}, {id: 'hnsmall', name: '홈앤쇼핑', grp: 'tv'},
  {id: 'immall', name: '공영쇼핑', grp: 'tv'},
  {id: 'nsmallplus', name: 'NS Shop+', grp: 'tc', ns: true}, {id: 'gsmyshop', name: 'GS마이샵', grp: 'tc'}, {id: 'cjmallplus', name: 'CJ온스타일+', grp: 'tc'},
  {id: 'lotteonetv', name: '롯데OneTV', grp: 'tc'}, {id: 'hmallplus', name: '현대홈쇼핑+샵', grp: 'tc'}, {id: 'bshop', name: 'SK스토아', grp: 'tc'},
  {id: 'kshop', name: 'KT알파쇼핑', grp: 'tc'}, {id: 'kshopplus', name: 'KT알파쇼핑+', grp: 'tc'}, {id: 'ssgshop', name: '신세계쇼핑', grp: 'tc'},
  {id: 'shopnt', name: '쇼핑엔티', grp: 'tc'}, {id: 'wshop', name: 'W쇼핑', grp: 'tc'},
];
export const CH = Object.fromEntries(CHANNELS.map(c => [c.id, c]));
export const isNS = ch => !!(CH[ch] && CH[ch].ns);

export const CATS = ['식품', '건강식품', '뷰티', '생활·주방', '가전·디지털', '의류', '잡화·주얼리', '침구·가구', '건강·운동용품', '보험·여행·서비스', '기타', '미분류'];

// Match levels, strongest first. `def` = shown by default.
export const LEVELS = [
  {k: 'model', label: '같은 모델', def: true, hint: '모델명·품번이 같음'},
  {k: 'same', label: '같은 상품', def: true, hint: '브랜드가 같고 상품명 핵심어가 겹침'},
  {k: 'similar', label: '비슷한 상품', def: true, hint: '브랜드 표기는 다르지만 상품명이 많이 겹치고 상품군이 같음'},
  {k: 'brand', label: '같은 브랜드', def: false, hint: '브랜드만 같음 (다른 상품일 수 있음)'},
  {k: 'group', label: '같은 상품군', def: false, hint: '브랜드는 다르고 상품군만 같음'},
];
export const LEVEL_RANK = Object.fromEntries(LEVELS.map((l, i) => [l.k, i]));

// ---------- CSV ----------
export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()) && !r[0].trim().startsWith('#'));
}

// ---------- text helpers ----------
const PAIRS = [['[', ']'], ['【', '】'], ['★', '★'], ['☆', '☆'], ['♥', '♥'], ['♡', '♡'], ['◆', '◆'], ['◇', '◇'], ['▲', '▲'], ['◀', '▶'], ['*', '*']];
export function stripPromo(n) {
  let s = ' ' + (n || '') + ' ';
  for (const [a, b] of PAIRS) {
    const re = new RegExp(esc(a) + '[^' + esc(a) + esc(b) + ']{0,40}' + esc(b), 'g');
    s = s.replace(re, ' ');
  }
  s = s.replace(/[○●◎□■▲△▽▷◀▶◆◇★☆♥♡※]/g, ' ').replace(/^\s*T(?=[가-힣])/, ' ');
  return s.replace(/\s+/g, ' ').trim();
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const norm = s => (s || '').toUpperCase().replace(/[^0-9A-Z가-힣]/g, '');
// The product itself, before the "+ freebies" part.
export function mainPart(n) {
  const s = stripPromo(n);
  const i = s.indexOf('+');
  return i > 3 ? s.slice(0, i) : s;
}

// ---------- dictionary ----------
export function loadDict(groupsCsv, catsCsv) {
  const g = parseCSV(groupsCsv).slice(1).map(r => ({
    kw: (r[0] || '').trim(), grp: (r[1] || '').trim(), cat: (r[2] || '').trim(),
    scope: (r[3] || '').trim() ? new Set(r[3].split('|').map(x => x.trim())) : null,
  })).filter(x => x.kw && x.grp).map(x => ({...x, k: norm(x.kw)})).filter(x => x.k);
  const cats = new Map();
  for (const r of parseCSV(catsCsv).slice(1)) {
    const c1 = (r[0] || '').trim(), c2 = (r[1] || '').trim(), cat = (r[2] || '').trim();
    if (c1 && cat) cats.set(c1 + '>' + c2, cat);
  }
  return {groups: g, cats};
}
export function baseCat(it, dict) {
  if (!it.c1) return '미분류';
  return dict.cats.get(it.c1 + '>' + (it.c2 || '')) || dict.cats.get(it.c1 + '>') || '기타';
}
// -> {cat, grp, src: 'dict'|'hsmoa'|'', kw}
export function classify(it, dict) {
  const base = baseCat(it, dict);
  const pick = text => {
    const t = norm(text); let best = null, bestPos = -1;
    for (const g of dict.groups) {
      if (g.scope && !g.scope.has(base) && base !== '미분류') continue;
      if (g.scope && base === '미분류' && !g.scope.has('미분류')) continue;
      const pos = t.lastIndexOf(g.k);
      if (pos < 0) continue;
      // longest keyword wins; on a tie the one nearer the end (the product type usually comes last)
      if (!best || g.k.length > best.k.length || (g.k.length === best.k.length && pos > bestPos)) { best = g; bestPos = pos; }
    }
    return best;
  };
  const main = mainPart(it.n);
  const g = pick(main.replace(/\([^)]*\)/g, ' ')) || pick(main) || pick(stripPromo(it.n));
  if (g) return {cat: g.cat || base, grp: g.grp, src: 'dict', kw: g.kw};
  return {cat: base, grp: it.c3 || it.c2 || '', src: it.c3 || it.c2 ? 'hsmoa' : '', kw: ''};
}

// ---------- matching ----------
const QTY = /\d+(\.\d+)?\s*(박스|개월분|개월|주분|주|병|포|봉|통|팩|개입|개|세트|종|마리|미|켤레|장|캡슐|정|매|입|구|KG|G|ML|L|MG|IU|X)?/gi;
const STOP = ['방송에서만', '최신상', '기본구성', '풀세트', '풀패키지', '패키지', '세트', '구성', '시즌', '단독', '런칭', '최대', '최다', '특집', '프리미엄',
  '시그니처', '골드', '플러스', '더블', '스페셜', '총', '더', 'NEW', 'SET', 'FW', 'SS', '여성', '남성', '여성용', '남성용', '남녀공용', '년형', '신상'];
const STOPN = STOP.map(norm).sort((a, b) => b.length - a.length);
const BAD_BRAND = /^(NOBRAND|브랜드없음|기타|없음|SK|LK|SS|K|Q|S|TV)$|^NOBRAND/;
export function brandKey(it) {
  const b = norm(it.b);
  if (b.length < 2 || BAD_BRAND.test(b) || STOPN.includes(b)) return '';
  return b;
}
// Items without a brand: take the first word if it is a brand seen elsewhere, else a short leading [bracket] that names one.
export function fillBrands(items) {
  const known = new Set(items.map(i => i._b).filter(b => b && b.length >= 2));
  for (const it of items) {
    if (it._b) continue;
    const brackets = [...(it.n || '').matchAll(/\[([^\]]{2,14})\]/g)].map(m => norm(m[1]));
    const words = stripPromo(it.n).split(' ').slice(0, 2).map(norm);
    const cand = [...words, ...brackets].find(w => w.length >= 2 && known.has(w));
    if (cand) { it._b = cand; it._bg = 1; }
  }
  return items;
}
// Model codes: letters+digits, at least 5 chars (VR90F01AAG, BNR17 is too short to be safe on its own)
export function models(it) {
  const out = new Set();
  for (const m of (it.n || '').toUpperCase().matchAll(/[A-Z0-9][A-Z0-9-]{4,}/g)) {
    const t = m[0].replace(/-/g, '');
    if (t.length >= 6 && /[A-Z]/.test(t) && /\d/.test(t) && !/^\d+(KG|G|ML|MG|EA|IU|MM|CM)$/.test(t) && !/^(19|20)\d\d/.test(t)) out.add(t);
  }
  return out;
}
// Core name: main part, without brand, quantities and filler words.
export function coreName(it) {
  let s = mainPart(it.n).replace(/\([^)]*\)/g, ' ').replace(QTY, ' ');
  let t = norm(s);
  const b = brandKey(it); if (b && b.length >= 2) t = t.split(b).join('');
  for (const w of STOPN) if (w.length >= 2) t = t.split(w).join('');
  return t;
}
const bigrams = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
export function dice(a, b) {
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), B = bigrams(b); let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v; for (const v of B.values()) nb += v;
  for (const [g, v] of A) if (B.has(g)) inter += Math.min(v, B.get(g));
  return 2 * inter / (na + nb);
}
// Pre-computed per item so matching stays fast in the browser.
export function prep(it, dict) {
  const c = classify(it, dict);
  return Object.assign(it, {cat: c.cat, grp: c.grp, gsrc: c.src, kw: c.kw, _b: brandKey(it), _core: coreName(it), _m: models(it), _nn: norm(stripPromo(it.n))});
}
function sameBrand(a, b) {
  if (a._b && b._b) return a._b === b._b || (a._b.length >= 2 && b._nn.includes(a._b)) || (b._b.length >= 2 && a._nn.includes(b._b));
  if (a._b && a._b.length >= 2) return b._nn.includes(a._b);
  if (b._b && b._b.length >= 2) return a._nn.includes(b._b);
  return false;
}
// -> {lv, score} or null
export function matchLevel(a, b) {
  for (const m of a._m) if (b._m.has(m)) return {lv: 'model', score: 1};
  const sameGrp = a.gsrc === 'dict' && b.gsrc === 'dict' && a.grp === b.grp;
  const sb = sameBrand(a, b);
  if (!sb && !sameGrp) return null;
  const d = dice(a._core, b._core);
  if (sb && (d >= 0.3 || (sameGrp && norm(a.kw) === norm(b.kw)))) return {lv: 'same', score: d};
  if (!sb && sameGrp) {
    // different brand: the names must overlap beyond the product-type keyword itself ("포기김치" alone is not enough)
    const ka = norm(a.kw), kb = norm(b.kw);
    const xa = ka ? a._core.split(ka).join('') : a._core, xb = kb ? b._core.split(kb).join('') : b._core;
    const dx = dice(xa, xb);
    if (xa.length >= 3 && xb.length >= 3 && dx >= 0.5 && d >= 0.5) return {lv: 'similar', score: dx};
  }
  if (sb) return {lv: 'brand', score: d};
  if (sameGrp) return {lv: 'group', score: d};
  return null;
}

// ---------- dates ----------
export const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);
export const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
export const price = it => it.sp || it.p || 0;
