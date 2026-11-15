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

// 8. Real app, not a demo: no hardcoded passcode, no seeded data on boot,
//    no demo labels; setup screen + lock-screen sign-in + sample link exist
const stateLine = (script.match(/let state = \{[^;]*\};/) || [])[0] || '';
check('initial state has an empty passcode', /passcode: ''/.test(stateLine));
check('initial state starts empty (no seeded medicines)', /medicines: \[\]/.test(stateLine));
check('unlock never falls back to a hardcoded passcode', !/\|\| ['"]1234['"]/.test(script));
check('quoted "1234" appears exactly once in the script (the sample profile passcode)', (script.match(/'1234'/g) || []).length === 1);
check('load() never seeds demo data', !/seedData/.test(script));
check('sampleData is called from exactly one place (the sample link)', (script.match(/sampleData\(\)/g) || []).length === 2);
check('no "Demo passcode" text anywhere', !/Demo passcode/i.test(html));
check('no "DEMO DATA" footer', !/DEMO DATA/.test(html));
check('medical-advice footer present', /does not replace medical advice/.test(html));
check('setup screen exists and is hidden by default', /id="setupScreen" class="hidden/.test(html));
check('lock-screen sign-in button exists', htmlIds.has('lockAuthBtn'));
check('sample profile link exists', htmlIds.has('sampleProfileBtn'));
check('sample banner exists', htmlIds.has('sampleBanner'));
check('empty-state strings present', ['no_meds', 'no_appts', 'no_members', 'no_vitals'].every(k => new RegExp(k + ':\\s*"').test(script)));

// 9. P0 fixes from the second judge panel (13:27 fix round)
// 9a. setupSubmit must preserve data already pulled from the cloud
check('setupSubmit preserves pulled arrays (no fresh-device wipe)', /medicines: state\.medicines \|\| \[\]/.test(script));
check('setupSubmit preserves pulled appointments', /appointments: state\.appointments \|\| \[\]/.test(script));
// 9b. auth errors: 401 is the ONLY wrong-password message; 5xx/network retry + wake-up message
check('wrong-password message appears exactly once (the 401 branch)', (script.match(/Wrong email or password/g) || []).length === 1);
check('401 is checked explicitly before the wrong-password message', /res\.status === 401/.test(script));
check('sign-in retry helper exists', /function signInWithRetry/.test(script));
check('cold-start retry waits ~50s', /COLD_START_RETRY_MS = 50000/.test(script));
check('wake-up message exists', /Cloud is waking up — please try again in a moment/.test(script));
check('sign-up retries on 5xx/network too', /Same cold-start retry as sign-in/.test(script));
// 9c. share links must not contain the passcode
const shareFn = (script.match(/function shareProfile\(\) \{[\s\S]*?\n\}/) || [])[0] || '';
check('shareProfile strips the passcode from the payload', /const \{ passcode, \.\.\.shared \} = state/.test(shareFn));
check('shareProfile encodes the stripped payload, not the whole state', /JSON\.stringify\(shared\)/.test(shareFn) && !/JSON\.stringify\(state\)/.test(shareFn));
// 9d. sign-in must not destroy local data: pull first, push when no server state
check('syncAfterSignIn helper exists', /function syncAfterSignIn/.test(script));
check('sign-in uses syncAfterSignIn (not a bare syncPull)', /await syncAfterSignIn\(\)/.test(script));
check('syncAfterSignIn pushes local data when pull finds nothing', /if \(!pulled\) await api\.syncPush\(\)/.test(script));

// 10. QA fixes (M1/M2/M4/M5) + quick P1s
// M1: getAdherence skips days before a medicine was created (same guard as getStreak)
check('getAdherence has the createdAt guard', /function getAdherence\(\)[\s\S]*?m\.createdAt && m\.createdAt > d/.test(script));
// M2: sample profile asks for confirmation first
check('sample profile confirms before replacing the local profile', /confirm\('Load the sample profile\?/.test(script));
// M4: share import signs out first so it never overwrites the cloud backup
check('load() signs out before applying shared state', /function load\(\)[\s\S]*?api\.token = ''[\s\S]*?state = \{/.test(script));
// M5: share import merges over the default shape (partial links cannot crash the app)
check('load() validates the shared appointments array', /appointments: Array\.isArray\(shared\.appointments\) \? shared\.appointments : \[\]/.test(script));
check('load() defaults a missing doseLog to {}', /doseLog: shared\.doseLog && typeof shared\.doseLog === 'object' \? shared\.doseLog : \{\}/.test(script));
check('load() never imports a passcode from a link', /passcode: '',\n\s*sample: false,/.test(script));
// P1: empty adherence shows a dash, never a false 100%
check('empty adherence shows "No doses yet"', /No doses yet — add a medicine to start tracking/.test(script));
// P1: contrast fixes
check('--text-light is the darker #475569', /--text-light:#475569/.test(html));
check('no text-[10px] disclaimer remains', !/text-\[10px\]/.test(html));

// 11. Fix round 2 (browser QA, 15 Nov): passcode modal, share modal,
//     future-slot disabling, dose-row spacing, weight unit, reminders
// 11a. Bug 1 — no native prompt() anywhere; passcode change is an in-app
//      modal that verifies the old passcode first
check('no native prompt() calls remain in the script', !/\bprompt\(/.test(script));
check('changePasscode function is gone', !/function changePasscode/.test(script));
check('passcode modal exists', htmlIds.has('passModal'));
for (const id of ['passOld', 'passNew', 'passConfirm', 'passError', 'passSuccess', 'passSave', 'passCancel']) {
  check(`passcode modal field #${id} exists`, htmlIds.has(id));
}
check('pass save verifies the old passcode first', /oldPass !== state\.passcode/.test(script));
check('pass save validates the new passcode is 4 digits', /!\/\^\\d\{4\}\$\/\.test\(next\)/.test(script));
check('pass save checks the confirmation matches', /next !== confirmPass/.test(script));
check('pass modal is wired to the change-passcode button', /\$\('changePassBtn'\)\.onclick = openPassModal/.test(script));
// 11b. Bug 2 — share shows the link visibly in-app, never via alert/prompt
check('share modal exists', htmlIds.has('shareModal'));
for (const id of ['shareLinkInput', 'shareCopyBtn', 'shareCopiedMsg', 'shareCloseBtn']) {
  check(`share modal element #${id} exists`, htmlIds.has(id));
}
check('shareProfile fills the visible link input', /\$\('shareLinkInput'\)\.value = url/.test(script));
check('shareProfile opens the share modal', /\$\('shareModal'\)\.style\.display = 'flex'/.test(script));
check('share copy button has a clipboard fallback (select)', /shareCopyBtn[\s\S]*?\.select\(\)/.test(script));
// 11c. Bug 3 — future slots cannot be marked early
check('future slots are computed from the slot hour vs now', /future = SLOT_HOURS\[slot\] > new Date\(\)\.getHours\(\)/.test(script));
check('Taken button is disabled for future slots', /takenDis = status === 'taken' \|\| future/.test(script));
check('Missed button is disabled for future slots', /missedDis = status === 'missed' \|\| future/.test(script));
// 11d. Bug 4 — dose row keeps a space between name and dose
check('dose row uses a non-breaking space between name and dose', /escapeHtml\(m\.name\)\}&nbsp;<span/.test(script));
// 11e. Bug 5 — Weight shows kg (display only)
check('weight display helper exists', /vitalDisplay/.test(script));
check('bare-number Weight displays with kg', /\+ ' kg'/.test(script));
// 11f. Bug 6 — reminders: Overdue label, missed stays visible, dismiss records
check('overdue pending dose is labelled Overdue, not Missed', /text: `Overdue: /.test(script));
check('explicitly missed dose still appears as Missed', /else if \(status === 'missed'\)[\s\S]*?text: `Missed: /.test(script));
check('dismissing a miss-* reminder records it in doseLog', /doseLog\[key\] = 'missed'/.test(script));
// 11g. Bug 7 — every delete/reset path confirms first (verified, not changed)
for (const [fn, msg] of [['deleteMed', 'Remove this medicine?'], ['deleteAppt', 'Delete this appointment?'], ['deleteMember', 'Remove this member from the care circle?'], ['resetDemo', 'Reset all data?']]) {
  check(`${fn} confirms before deleting`, new RegExp(`function ${fn}[\\s\\S]*?confirm\\("${msg.replace('?', '\\?')}`).test(script));
}

// 12. Fix round 3 (15 Nov): setup-screen sample entry, persisted
//     dismissals, signed-in lock-screen hint
// 12a. A fresh visitor only ever sees the setup screen, so the sample
//      profile must be reachable from there too — same shared path.
check('setup screen sample button exists', htmlIds.has('setupSampleBtn'));
check('setup sample button sits inside the setup screen', /id="setupScreen"[\s\S]*?id="setupSampleBtn"/.test(html));
check('shared loadSampleProfile function exists', /function loadSampleProfile\(\)/.test(script));
check('lock-screen sample button uses the shared function', /\$\('sampleProfileBtn'\)\.onclick = loadSampleProfile/.test(script));
check('setup-screen sample button uses the shared function', /\$\('setupSampleBtn'\)\.onclick = loadSampleProfile/.test(script));
check('sample confirm still guards the shared path', /function loadSampleProfile\(\)[\s\S]*?confirm\('Load the sample profile\?/.test(script));
check('sampleData still called from exactly one place', (script.match(/sampleData\(\)/g) || []).length === 2);
// 12b. Dismissed reminders survive a reload (separate key, date-scoped,
//      never synced to the cloud)
check('dismissed-reminders key is separate from state', /DISMISSED_KEY = 'sahayakcare_dismissed_v1'/.test(script));
check('dismissal keys are date-prefixed', /const dismissKey = id => `\$\{todayStr\(\)\}\|\$\{id\}`/.test(script));
check('loadDismissed helper exists', /function loadDismissed\(\)/.test(script));
check('loadDismissed drops stale (non-today) entries', /k\.startsWith\(todayStr\(\) \+ '\|'\)/.test(script));
check('saveDismissed writes the separate key', /function saveDismissed\(\)[\s\S]*?localStorage\.setItem\(DISMISSED_KEY/.test(script));
check('dismissals are loaded at boot', /load\(\);\s*\n\s*loadDismissed\(\);/.test(script));
check('buildReminders filter uses the date-prefixed key', /dismissedReminders\.has\(dismissKey\(item\.id\)\)/.test(script));
check('dismissReminder persists the dismissal', /function dismissReminder[\s\S]*?saveDismissed\(\)/.test(script));
check('markDose Taken drops the dismissal for that dose', /function markDose[\s\S]*?dismissedReminders\.delete\(dismissKey\(`\$\{p\}-\$\{medId\}-\$\{slot\}`\)\)/.test(script));
check('dismissals are never sent to the cloud (syncPush payload)', !/syncPush\(\)[\s\S]*?dismissed/.test(script.split('async syncPush')[1].split('},')[0]));
check('resetDemo clears persisted dismissals', /function resetDemo[\s\S]*?localStorage\.removeItem\(DISMISSED_KEY\)[\s\S]*?dismissedReminders\.clear\(\)/.test(script));
// 12c. Lock screen explains the two locks when signed in
check('signed-in hint element exists', htmlIds.has('lockSignedInHint'));
check('hint sits under the signed-in state line', /id="lockAuthState"[\s\S]*?id="lockSignedInHint"/.test(html));
check('hint is shown when signed in', /function refreshLockAuthUI[\s\S]*?\$\('lockSignedInHint'\)\.style\.display = email \? 'block' : 'none'/.test(script));
check('hint English text present', /lock_signedin_hint: "You're signed in for cloud sync — enter your 4-digit passcode to open this profile\."/.test(script));
check('hint Hindi text present', /lock_signedin_hint: "आप क्लाउड सिंक के लिए साइन इन हैं — प्रोफ़ाइल खोलने के लिए अपना 4 अंकों का पासकोड डालें।"/.test(script));
check('auth flow is unchanged (no auto-unlock on sign-in)', !/authSignIn[\s\S]*?unlockBtn['"]\)\.click/.test(script));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
