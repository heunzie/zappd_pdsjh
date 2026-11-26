// TEMP test (remove after review): which Gemini model / search option does this free key allow?
import fs from 'node:fs';
const KEY = process.env.GEMINI_API_KEY;
const OUT = 'data/probe/gemini.json';
const api = 'https://generativelanguage.googleapis.com/v1beta/';
const res = {at: new Date().toISOString(), tries: []};
const save = () => { fs.mkdirSync('data/probe', {recursive: true}); fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); };
const prompt = '한국 TV TV조선 「질병의 법칙 129회」(2026년 11월 26일 방송) 회차 내용을 Google 검색으로 찾아 "주제: / 출연: / 소개:" 형식으로 짧게 답해줘. 이 회차 정보를 못 찾으면 "정보 없음"이라고만 답해.';
for (const model of ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']) {
  for (const search of [true, false]) {
    const row = {model, search};
    try {
      const body = {contents: [{parts: [{text: search ? prompt : '한 단어로 답해: 안녕'}]}]};
      if (search) body.tools = [{google_search: {}}];
      const r = await fetch(`${api}models/${model}:generateContent?key=${KEY}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(60000)});
      const j = await r.json(); row.status = r.status;
      if (!r.ok) row.error = (j.error && j.error.message || '').slice(0, 400);
      const c = (j.candidates || [])[0] || {};
      row.text = ((c.content || {}).parts || []).map(p => p.text || '').join('').trim().slice(0, 600);
      const g = c.groundingMetadata || {}; row.queries = g.webSearchQueries || []; row.sources = (g.groundingChunks || []).map(x => x.web && x.web.title).filter(Boolean).slice(0, 6);
    } catch (e) { row.error = String(e).slice(0, 200); }
    res.tries.push(row); save();
    await new Promise(r => setTimeout(r, 3000));
  }
}
save();
