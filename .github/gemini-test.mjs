// TEMP test (remove after review): summary line + keywords for recent episodes (no search)
import fs from 'node:fs';
const KEY = process.env.GEMINI_API_KEY;
const api = 'https://generativelanguage.googleapis.com/v1beta/';
const eps = JSON.parse(fs.readFileSync('data/episodes.json', 'utf8'));
const pick = Object.entries(eps).filter(([, v]) => v.full && v.full.length > 60).sort((a, b) => (b[1].air || '').localeCompare(a[1].air || '')).slice(0, 20);
const list = pick.map(([k, v], i) => `${i + 1}. [${k.replace('|', ' ')}] ${v.full.slice(0, 800)}`).join('\n');
const prompt = `아래는 한국 TV 프로그램 회차 소개글이다. 홈쇼핑 PD가 "이 시간에 저 채널은 무슨 내용을 하나"를 한눈에 보려는 용도다.
각 항목마다:
- sum: 이 회차 핵심 내용 한 줄, 25자 안팎. "~ 사연", "~ 비법", "~ 소개", "~ 대결"처럼 명사로 끝낼 것. 프로그램 이름은 넣지 말 것.
- kw: 키워드 2~3개, 각 6자 이내. 프로그램 이름 금지. 우선순위: ①음식·식재료·건강성분·질환 ②제품·생활용품 ③유명 출연자.
소개글에 없는 내용은 절대 지어내지 말 것. 내용이 빈약하면 sum만 짧게 쓰고 kw는 빈 배열.
JSON 배열로만 답: [{"n":번호,"sum":"...","kw":["..",".."]}]

${list}`;
const res = {at: new Date().toISOString(), runs: []};
const save = () => { fs.mkdirSync('data/probe', {recursive: true}); fs.writeFileSync('data/probe/gemini-sum2.json', JSON.stringify(res, null, 1)); };
for (const model of ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite']) {
  const row = {model};
  for (let t = 0; t < 3; t++) {
    try {
      const t0 = Date.now();
      const r = await fetch(`${api}models/${model}:generateContent?key=${KEY}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: {responseMimeType: 'application/json', temperature: 0.2}}), signal: AbortSignal.timeout(90000)});
      const j = await r.json(); row.status = r.status; row.ms = Date.now() - t0;
      if (!r.ok) { row.error = (j.error && j.error.message || '').slice(0, 300); if (r.status === 503) { await new Promise(s => setTimeout(s, 8000)); continue; } break; }
      const txt = (((j.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || '').join('') || '';
      let arr = []; try { arr = JSON.parse(txt); } catch (e) { row.raw = txt.slice(0, 1500); }
      row.out = pick.map(([k, v], i) => { const o = arr.find(a => a.n === i + 1) || {}; return {key: k, air: v.air, old: v.line, sum: o.sum, kw: o.kw, full: v.full.slice(0, 300)}; });
      delete row.error; break;
    } catch (e) { row.error = String(e).slice(0, 200); }
  }
  res.runs.push(row); save(); await new Promise(s => setTimeout(s, 4000));
}
save();
