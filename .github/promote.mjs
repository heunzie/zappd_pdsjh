// beta.html → index.html
// 실제 보드(index.html)는 직접 고치지 않고, 둘 다 확인한 beta.html에서 이 스크립트로 만든다.
// 테스트 페이지 표시(<!--BETA-ONLY-->…<!--/BETA-ONLY-->, /* BETA-ONLY */…/* /BETA-ONLY */, 탭 제목 [테스트])만 빼고 그대로 복사.
import fs from 'node:fs';

const src = fs.readFileSync('beta.html', 'utf8');
let out = src
  .replace(/[ \t]*<!--BETA-ONLY-->[\s\S]*?<!--\/BETA-ONLY-->\n?/g, '')
  .replace(/\/\* BETA-ONLY \*\/[\s\S]*?\/\* \/BETA-ONLY \*\/\n?/g, '')
  .replace('<title>[테스트] ', '<title>');
out = out.replace(/^(<!doctype html>\n)/i, `$1<!-- 이 파일은 beta.html에서 자동으로 만들어져요 (.github/promote.mjs). 직접 고치지 마세요. -->\n`);

const bad = ['betabar', 'betatag', 'betabadge', 'BETA-ONLY', '[테스트]'].filter(k => out.includes(k));
if (bad.length) { console.error('테스트 페이지 표시가 남아 있어요:', bad.join(', ')); process.exit(1); }
if (!out.includes('<title>NS 재핑 보드</title>')) { console.error('제목이 이상해요'); process.exit(1); }
fs.writeFileSync('index.html', out);
console.log(`index.html 만들기 완료 (${out.length.toLocaleString()}자)`);
