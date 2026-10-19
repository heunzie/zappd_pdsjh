// Copies data/ into a monthly archive (archive/) for the SCM page (scm.html).
// The zapping board deletes days older than 60 days; this archive keeps them.
//   node scripts/archive.mjs [source=data] [out=archive]
// For every day present in the source, that day's broadcasts replace what the archive had (the source is newer);
// days no longer in the source are kept as they are.
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.argv[2] || 'data');
const OUT = path.resolve(process.argv[3] || 'archive');
const FIELDS = ['ch', 'd', 's', 'e', 'n', 'b', 'c1', 'c2', 'c3', 'p', 'sp', 'u'];
// product links without tracking parameters (keeps product ids)
const cleanUrl = u => {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|hsmoa|refer|ordermedia|mediacode|mediatarget|NaPm)/i.test(k)) x.searchParams.delete(k);
    return x.toString();
  } catch { return u || ''; }
};
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

fs.mkdirSync(OUT, {recursive: true});
const srcIndex = readJson(path.join(SRC, 'index.json')) || {};

// source: date -> {tv: items|null, tc: items|null}
const src = new Map();
for (const f of fs.readdirSync(SRC)) {
  const m = f.match(/^(t-)?(\d{4}-\d\d-\d\d)\.json$/);
  if (!m) continue;
  const doc = readJson(path.join(SRC, f));
  if (!doc || !Array.isArray(doc.items)) continue;
  const e = src.get(m[2]) || {tv: null, tc: null};
  e[m[1] ? 'tc' : 'tv'] = doc.items.map(it => Object.fromEntries(FIELDS.map(k => [k, it[k] ?? (k === 'p' || k === 'sp' ? 0 : '')])))
    .map(it => ({...it, d: it.d || m[2], u: cleanUrl(it.u)}));
  src.set(m[2], e);
}
if (!src.size) { console.log('no source data in', SRC); process.exit(1); }

const TC = new Set(['nsmallplus', 'gsmyshop', 'cjmallplus', 'lotteonetv', 'hmallplus', 'kshop', 'kshopplus', 'bshop', 'ssgshop', 'shopnt', 'wshop']);
const grpOf = ch => TC.has(ch) ? 'tc' : 'tv';

const byMonth = new Map();
for (const d of src.keys()) { const mo = d.slice(0, 7); if (!byMonth.has(mo)) byMonth.set(mo, []); byMonth.get(mo).push(d); }

const index = readJson(path.join(OUT, 'index.json')) || {months: []};
const months = new Set(index.months.map(m => m.month));
const stats = {};
for (const [mo, days] of byMonth) {
  const file = path.join(OUT, mo + '.json');
  const doc = readJson(file) || {month: mo, items: []};
  let items = doc.items;
  let changed = 0;
  for (const d of days) {
    for (const g of ['tv', 'tc']) {
      const fresh = src.get(d)[g];
      if (!fresh) continue;
      const before = items.filter(it => it.d === d && grpOf(it.ch) === g);
      const sig = a => JSON.stringify(a.map(x => [x.ch, x.s, x.n, x.sp]).sort());
      if (before.length && sig(before) === sig(fresh)) continue;
      items = items.filter(it => !(it.d === d && grpOf(it.ch) === g)).concat(fresh);
      changed++;
    }
  }
  if (!changed && fs.existsSync(file)) { stats[mo] = 'same'; continue; }
  items.sort((a, b) => a.d.localeCompare(b.d) || a.s.localeCompare(b.s) || a.ch.localeCompare(b.ch));
  fs.writeFileSync(file, JSON.stringify({month: mo, updatedAt: nowIso(), items}));
  months.add(mo);
  stats[mo] = `${changed} day-groups updated, ${items.length} items`;
}

// rebuild the index from what is on disk
const list = [];
for (const mo of [...months].sort()) {
  const doc = readJson(path.join(OUT, mo + '.json'));
  if (!doc) continue;
  const ds = doc.items.map(i => i.d).sort();
  list.push({month: mo, items: doc.items.length, from: ds[0], to: ds[ds.length - 1], bytes: fs.statSync(path.join(OUT, mo + '.json')).size});
}
const all = list.flatMap(m => [m.from, m.to]).filter(Boolean).sort();
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  updatedAt: nowIso(), sourceUpdatedAt: srcIndex.updatedAt || '', from: all[0], to: all[all.length - 1], months: list,
}, null, 1));
console.log(JSON.stringify(stats, null, 1));
