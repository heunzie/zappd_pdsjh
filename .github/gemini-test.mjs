// TEMP test (remove after review): can the free key summarize the Daum synopsis we already collect (no search)?
import fs from 'node:fs';
const KEY = process.env.GEMINI_API_KEY;
const OUT = 'data/probe/gemini-sum.json';
const api = 'https://generativelanguage.googleapis.com/v1beta/';
const eps = JSON.parse(fs.readFileSync('data/episodes.json', 'utf8'));
const pick = Object.entries(eps).filter(([, v]) => v.full && v.full.length > 60).slice(0, 15);
const list = pick.map(([k, v], i) => `${i + 1}. [${k.replace('|', ' ')}] ${v.full.slice(0, 700)}`).join('\n');
const prompt = `아래는 한국 TV 프로그램 회차 소개글 목록이다. 홈쇼핑 PD가 편성표에서 한눈에 볼 요약을 만든다.
각 항목마다:
- sum: 이 회차가 무슨 내용인지 30자 안팎 한 줄. "~ 소개", "~ 사연", "~ 비법"처럼 명사로 끝낼 것. 프로그램 이름은 빼고 내용만.
- kw: 핵심 키워드 2~3개 (음식·건강·제품·출연자 위주, 각 6자 이내)
소개글에 없는 내용은 절대 지어내지 말 것. 내용이 부족하면 있는 만큼만.
JSON 배열로만 답: [{"n":번호,"sum":"...","kw":["..",".."]}]

${list}`;
const res = {at: new Date().toISOString(), runs: []};
const save = () => { fs.mkdirSync('data/probe', {recursive: true}); fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); };
for (const model of ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-flash-latest']) {
  const row = {model};
  for (let t = 0; t < 3; t++) {
    try {
      const body = {contents: [{parts: [{text: prompt}]}], generationConfig: {responseMimeType: 'application/json', temperature: 0.2}};
      const t0 = Date.now();
      const r = await fetch(`${api}models/${model}:generateContent?key=${KEY}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(90000)});
      const j = await r.json(); row.status = r.status; row.ms = Date.now() - t0; row.try = t + 1;
      if (!r.ok) { row.error = (j.error && j.error.message || '').slice(0, 300); if (r.status === 503) { await new Promise(s => setTimeout(s, 8000)); continue; } break; }
      const txt = (((j.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('') || '';
      row.usage = j.usageMetadata;
      let arr = []; try { arr = JSON.parse(txt); } catch (e) { row.raw = txt.slice(0, 1500); }
      row.out = pick.map(([k, v], i) => { const o = arr.find(a => a.n === i + 1) || {}; return {key: k, old: v.line, sum: o.sum, kw: o.kw}; });
      delete row.error; break;
    } catch (e) { row.error = String(e).slice(0, 200); }
  }
  res.runs.push(row); save();
  await new Promise(s => setTimeout(s, 4000));
}
res.input = pick.map(([k, v]) => ({key: k, full: v.full}));
save();
