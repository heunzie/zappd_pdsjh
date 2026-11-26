// TEMP test (remove after review): can Gemini + Google Search summarise today's 종편 episodes?
import fs from 'node:fs';
const KEY = process.env.GEMINI_API_KEY;
const OUT = 'data/probe/gemini.json';
const EPS = [
  ['JTBC', '건강 1120 32회'], ['JTBC', '이토록 위대한 몸 15회'],
  ['MBN', '해피라이프 Make Better Next 49회'], ['MBN', '보부상 44회'], ['MBN', '바디인사이트 56회'],
  ['채널A', '건강스페셜 한양촌 116회'], ['채널A', '건강한 식당 35회'], ['채널A', '몸으로 보는 세상 아모르바디 54회'],
  ['TV조선', '질병의 법칙 129회'], ['TV조선', '알콩달콩 347회'],
];
const DATE = '2026년 11월 26일';
const res = {at: new Date().toISOString(), model: null, results: []};
const save = () => { fs.mkdirSync('data/probe', {recursive: true}); fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); };
if (!KEY) { res.error = 'GEMINI_API_KEY missing'; save(); process.exit(0); }
const api = 'https://generativelanguage.googleapis.com/v1beta/';
// pick a Flash model this key can use
try {
  const m = await (await fetch(api + 'models?pageSize=200&key=' + KEY)).json();
  const names = (m.models || []).filter(x => (x.supportedGenerationMethods || []).includes('generateContent')).map(x => x.name.replace('models/', ''));
  res.available = names.filter(n => /flash/.test(n)).slice(0, 30);
  res.candidates = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash'].filter(n => names.includes(n));
  res.model = res.candidates[0];
} catch (e) { res.error = 'list models: ' + String(e).slice(0, 200); save(); process.exit(0); }
for (const [ch, ep] of EPS) {
  const prompt = `한국 TV ${ch} 「${ep}」(${DATE} 방송) 회차의 내용을 Google 검색으로 찾아서 아래 형식으로만 답해줘.
주제: (이 회차가 다루는 내용 한 줄)
출연: (전문가·게스트, 모르면 생략)
소개: (방송에서 소개되는 식품·제품·건강법, 있으면)
이 회차(${ep}) 정보를 찾지 못하면 다른 회차를 추측하지 말고 "정보 없음"이라고만 답해.`;
  const t0 = Date.now(); const row = {ch, ep};
  try {
    const r = await fetch(`${api}models/${res.model}:generateContent?key=${KEY}`, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({contents: [{parts: [{text: prompt}]}], tools: [{google_search: {}}]}), signal: AbortSignal.timeout(60000)});
    const j = await r.json();
    if (!r.ok) {
      row.error = (j.error && j.error.message || 'HTTP ' + r.status).slice(0, 300);
      // model retired for new keys: move to the next candidate and retry this episode once
      const next = res.candidates[res.candidates.indexOf(res.model) + 1];
      if (next && /no longer available|not found|not supported/i.test(row.error)) { res.model = next; res.results.push({...row, model: res.model}); EPS.splice(EPS.findIndex(e => e[1] === ep) + 1, 0, [ch, ep]); continue; }
    }
    row.model = res.model;
    const c = (j.candidates || [])[0] || {};
    row.text = ((c.content || {}).parts || []).map(p => p.text || '').join('').trim();
    const g = c.groundingMetadata || {};
    row.queries = g.webSearchQueries || [];
    row.sources = (g.groundingChunks || []).map(x => x.web && x.web.title).filter(Boolean).slice(0, 6);
    row.tokens = j.usageMetadata && j.usageMetadata.totalTokenCount;
  } catch (e) { row.error = String(e).slice(0, 200); }
  row.ms = Date.now() - t0; res.results.push(row); save();
  await new Promise(r => setTimeout(r, 4000));
}
save();
