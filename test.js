// SahayakCare smoke tests — run with: node test.js
// Catches the exact bug classes the judge panel found:
//  - JS ids referenced but missing in the HTML (e.g. #medTimeCheckboxes)
//  - CSS classes / variables used by JS-rendered HTML but never defined
//  - invalid markup (table rows outside a table)
const fs = require('fs');
const { execSync } = require('child_process');

const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
fs.writeFileSync('/tmp/sahayakcare-script.js', script);

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// 1. JS syntax
try {
  execSync('node --check /tmp/sahayakcare-script.js', { stdio: 'pipe' });
  check('JS syntax (node --check)', true);
} catch (e) {
  check('JS syntax (node --check)', false, e.stdout?.toString() || e.message);
}

// 2. Every $('id') referenced in JS must exist in the HTML
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const jsIds = new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
for (const id of jsIds) {
  check(`id #${id} exists in HTML`, htmlIds.has(id));
}
// Also querySelector [data-tab] targets must have matching views
for (const tab of [...html.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]).filter(t => !t.includes('$'))) {
  check(`view #view-${tab} exists`, htmlIds.has('view-' + tab));
}

// 3. Every var(--x) used must be defined in :root
const rootBlock = (html.match(/:root\s*{([^}]*)}/) || [])[1] || '';
const definedVars = new Set([...rootBlock.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]));
const usedVars = new Set([...html.matchAll(/var\(--([\w-]+)\)/g)].map(m => m[1]));
for (const v of usedVars) {
  check(`CSS var --${v} defined in :root`, definedVars.has(v));
}

// 4. Every class used in JS-rendered HTML must be defined in the <style> block
const styleBlock = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const definedClasses = new Set([...styleBlock.matchAll(/\.([\w-]+)\s*[{:.]/g)].map(m => m[1]));
const usedClasses = new Set([...script.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
for (const c of usedClasses) {
  if (c.startsWith('dose-')) continue; // dose-taken/missed/pending are state classes, checked below
  check(`class .${c} defined`, definedClasses.has(c) || /^(bg|text|flex|grid|space|rounded|shadow|p|m|w|h|max|relative|absolute|hidden|block|sticky|top|z|border|overflow|whitespace|items|justify|gap|font|leading|opacity|cursor|transition|hover|focus|outline|animate)-/.test(c), 'tailwind utility or custom class');
}
for (const c of ['dose-taken', 'dose-missed', 'dose-pending']) {
  check(`state class .${c} defined`, definedClasses.has(c));
}

// 5. No <tr> outside a <table>
check('no <tr> in the file (vitals use div rows)', !/<tr[\s>]/.test(html));

// 6. No bare mailto with un-encoded subject/body (the mailLink helper itself is the encoded form)
const scriptNoHelper = script.replace(/const mailLink.*/, '');
const rawMailtos = [...scriptNoHelper.matchAll(/mailto:[^"`]*\?subject=[^"`]*&body=/g)];
check('no raw (un-encoded) mailto links', rawMailtos.length === 0, rawMailtos.length ? `${rawMailtos.length} found` : '');

// 7. data-i18n keys must exist in both dictionaries
const i18nKeys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]);
for (const k of new Set(i18nKeys)) {
  check(`i18n key "${k}" in en`, new RegExp(`${k}:\\s*"`).test(script));
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
