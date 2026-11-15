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
// Brace-matched function extraction: returns the full `function ... {}`
// (or `async name() {}` method) source, so assertions run on the real
// body instead of a regex slice that can end early (the old 12b check
// proved the word "dismissed" absent from a truncated slice — vacuous).
function extractFn(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  const open = src.indexOf('{', i);
  if (open < 0) return '';
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return '';
}
// Comments mention native dialogs by name ("never a native confirm()");
// strip //-comments so absence checks test code, not prose.
const scriptNoComments = script.replace(/\/\/[^\n]*/g, '');
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

// 3. Every var(--x) used must be defined in :root — scoped to the app's
//    own CSS/JS. The inlined Tailwind block defines its --tw-* vars on
//    *,::before,::after (not :root), so it is excluded from this check.
const customStyle = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).find(b => b.includes(':root')) || '';
const rootBlock = (customStyle.match(/:root\s*{([^}]*)}/) || [])[1] || '';
const definedVars = new Set([...rootBlock.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]));
const usedVars = new Set([...(customStyle + script).matchAll(/var\(--([\w-]+)\)/g)].map(m => m[1]));
for (const v of usedVars) {
  check(`CSS var --${v} defined in :root`, definedVars.has(v));
}

// 4. Every class used in JS-rendered HTML must be defined in a <style>
//    block. Round 8 inlined the Tailwind build, so there are now TWO
//    <style> blocks (Tailwind utilities + the app's custom CSS) — the
//    defined set is the union of both.
const styleBlocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const styleBlock = styleBlocks;
const definedClasses = new Set([...styleBlock.matchAll(/\.([\w-]+)\s*[{:.]/g)].map(m => m[1]));
// A class counts as defined if it is in the set, or its CSS-escaped
// selector (variants like sm: and arbitrary values like bg-[#0F766E])
// appears in the style text, or it is a plain Tailwind utility prefix.
const cssEsc = c => c.replace(/[:\/.#[\]]/g, ch => '\\' + ch);
const classDefined = c => definedClasses.has(c) || styleBlock.includes('.' + cssEsc(c)) || /^(bg|text|flex|grid|space|rounded|shadow|p|m|w|h|max|relative|absolute|hidden|block|sticky|top|z|border|overflow|whitespace|items|justify|gap|font|leading|opacity|cursor|transition|hover|focus|outline|animate)-/.test(c);
const usedClasses = new Set([...script.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
for (const c of usedClasses) {
  if (c.startsWith('dose-')) continue; // dose-taken/missed/pending are state classes, checked below
  if (c.includes('$')) continue; // template placeholder, e.g. dose-${status}
  check(`class .${c} defined`, classDefined(c), 'tailwind utility or custom class');
}
// 4b. (Round 8) Static-HTML classes must be defined too — same union.
const staticHtml = html.replace(/<script>[\s\S]*?<\/script>/, '').replace(/<style>[\s\S]*?<\/style>/g, '');
const staticClasses = new Set([...staticHtml.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
for (const c of staticClasses) {
  if (c.startsWith('dose-') || c.includes('$')) continue;
  check(`static class .${c} defined`, classDefined(c), 'tailwind utility or custom class');
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

// 7. (Round 8) Every i18n key used — in data-i18n attributes AND in
//     t('...') calls in the JS — must exist in BOTH dictionaries.
//     A key in English only silently renders English under the Hindi
//     toggle, which is exactly the ~1/3-translated Hindi the audit found.
const enBlock = (script.match(/en: \{([\s\S]*?)\n    \},/) || [])[1] || '';
const hiBlock = (script.match(/hi: \{([\s\S]*?)\n    \}\n\};/) || [])[1] || '';
const enKeys = new Set([...enBlock.matchAll(/([A-Za-z_][A-Za-z0-9_]*):\s*"/g)].map(m => m[1]));
const hiKeys = new Set([...hiBlock.matchAll(/([A-Za-z_][A-Za-z0-9_]*):\s*"/g)].map(m => m[1]));
check('i18n en dictionary parses', enKeys.size > 50, `${enKeys.size} keys`);
check('i18n hi dictionary parses', hiKeys.size > 50, `${hiKeys.size} keys`);
const usedI18nKeys = new Set([
  ...[...html.matchAll(/data-i18n="([^"]+)"/g)].map(m => m[1]),
  ...[...script.matchAll(/t\('([A-Za-z_][A-Za-z0-9_]*)'\)/g)].map(m => m[1]),
]);
for (const k of [...usedI18nKeys].sort()) {
  check(`i18n key "${k}" in en`, enKeys.has(k));
  check(`i18n key "${k}" in hi`, hiKeys.has(k));
}

// 8. Real app, not a demo: no hardcoded passcode, no seeded data on boot,
//    no demo labels; setup screen + lock-screen sign-in + sample link exist
// Round 8: state comes from the emptyState() factory, not a literal.
const emptyStateFn = extractFn(script, 'function emptyState()');
check('emptyState factory exists', emptyStateFn.length > 0);
check('initial state is emptyState()', /let state = emptyState\(\);/.test(script));
check('emptyState has an empty passcode', /passcode: ''/.test(emptyStateFn));
check('emptyState starts with no medicines', /medicines: \[\]/.test(emptyStateFn));
check('unlock never falls back to a hardcoded passcode', !/\|\| ['"]1234['"]/.test(script));
// '1234' is allowed in exactly one place: the trivial-passcode
// blocklist that REJECTS it. Anywhere else it would be a live default.
check('"1234" appears only in the trivial-passcode blocklist', (script.match(/'1234'/g) || []).length === 1 && /const TRIVIAL_PASSCODES = \[[^\]]*'1234'[^\]]*\]/.test(script));
check('trivial blocklist also rejects 0000', /'0000'/.test(script));
check('no "passcode 1234" text remains in the HTML', !/passcode 1234/i.test(html));
check('load() never seeds demo data', !/seedData/.test(script));
check('sampleData is called from exactly one place (the sample link)', (script.match(/sampleData\(/g) || []).length === 2);
check('no "Demo passcode" text anywhere', !/Demo passcode/i.test(html));
check('no "DEMO DATA" footer', !/DEMO DATA/.test(html));
check('medical-advice footer present', /does not replace medical advice/.test(html));
check('setup screen exists and is hidden by default', /id="setupScreen" class="hidden/.test(html));
check('lock-screen sign-in link exists (secondary, below Unlock)', htmlIds.has('lockAuthBtn'));
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
check('shareProfile encodes the stripped payload via encodeShare', /encodeShare\(shared\)/.test(shareFn) && !/JSON\.stringify\(state\)/.test(shareFn));
const encodeFn = extractFn(script, 'function encodeShare(obj)');
const decodeFn = extractFn(script, 'function decodeShare(str)');
check('encodeShare uses TextEncoder + btoa (no escape())', /TextEncoder/.test(encodeFn) && /btoa/.test(encodeFn) && !/escape\(/.test(encodeFn));
check('decodeShare uses TextDecoder + atob (no unescape())', /TextDecoder/.test(decodeFn) && /atob/.test(decodeFn) && !/unescape\(/.test(decodeFn));
check('no escape()/unescape() calls remain in the script', !/escape\(|unescape\(/.test(scriptNoComments));
// 9d. sign-in must not destroy local data: pull first, push when no server state
check('syncAfterSignIn helper exists', /function syncAfterSignIn/.test(script));
check('sign-in uses syncAfterSignIn (not a bare syncPull)', /await syncAfterSignIn\(\)/.test(script));
const syncAfterSignInFn = extractFn(script, 'async function syncAfterSignIn()');
check('syncAfterSignIn pushes local data when the pull finds nothing (empty)', /res\.status === 'empty'[\s\S]*?noteSyncResult\(await api\.syncPush\(\)\)/.test(syncAfterSignInFn));
check('syncAfterSignIn pushes merged local data too', /res\.status === 'merged' && res\.mergedLocal[\s\S]*?noteSyncResult\(await api\.syncPush\(\)\)/.test(syncAfterSignInFn));
check('syncAfterSignIn never pushes on a pull error', /noteSyncResult\(\{ ok: false, status: 0 \}\)/.test(syncAfterSignInFn) && !/status === 'error'[\s\S]*?syncPush/.test(syncAfterSignInFn));

// 10. QA fixes (M1/M2/M4/M5) + quick P1s
// M1: getAdherence skips days before a medicine was created (same guard as getStreak)
check('getAdherence has the createdAt guard', /function getAdherence\(\)[\s\S]*?m\.createdAt && m\.createdAt > d/.test(script));
// M2: the sample modal itself warns that loading replaces the profile
//      (round 7: the native confirm() guard is gone — it auto-dismissed
//      as Cancel in automated browsers and killed the button entirely)
check('sample modal hint warns loading replaces the profile on this device', /sample_pass_hint: "Choose your own 4-digit passcode[^"]*Loading it replaces the profile on this device\."/.test(script));
// M4: share import signs out first so it never overwrites the cloud backup
check('applySharedProfile signs out before applying shared state', /function applySharedProfile\(shared\) \{[\s\S]*?api\.token = ''/.test(script));
check('applySharedProfile clears the imported passcode', /function applySharedProfile\(shared\) \{[\s\S]*?state\.passcode = ''/.test(script));
check('load() routes a valid share link through applySharedProfile', /function load\(\)[\s\S]*?applySharedProfile\(shared\)/.test(script));
// M5: share import merges over the default shape (partial links cannot crash the app)
check('validateSharedState validates medicines/appointments/circle/vitals', /function validateSharedState\(shared\)[\s\S]*?validShareMedicine[\s\S]*?validShareAppointment[\s\S]*?validShareMember[\s\S]*?validShareVital/.test(script));
check('shared medicines are restricted to the 4 known slots', /function validShareMedicine[\s\S]*?VALID_SLOTS\.includes\(s\)/.test(script));
check('shared stock is coerced to a non-negative int or null', /function validShareMedicine[\s\S]*?Math\.max\(0, parseInt\(m\.stock, 10\)/.test(script));
check('shared member emails are validated', /function validShareMember[\s\S]*?EMAIL_RE\.test\(c\.email\)/.test(script));
check('malformed doseLog keys are skipped on import', /function validateSharedState\(shared\)[\s\S]*?parseDoseKey\(k\)/.test(script));
check('load() never imports a passcode from a link', /function applySharedProfile\(shared\) \{[\s\S]*?state\.passcode = ''/.test(script));
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
check('pass save verifies the old passcode against the hash', /verifyPasscode\(oldPass, state\.passcode\)/.test(script));
check('pass save uses the shared validatePasscode', /const passErr = validatePasscode\(next, confirmPass\)/.test(script));
check('pass save stores the hash, never the plaintext', /state\.passcode = hashPasscode\(next\)/.test(script));
check('pass modal is wired to the change-passcode button', /\$\('changePassBtn'\)\.onclick = openPassModal/.test(script));
// 11b. Bug 2 — share shows the link visibly in-app, never via alert/prompt
check('share modal exists', htmlIds.has('shareModal'));
for (const id of ['shareLinkInput', 'shareCopyBtn', 'shareCopiedMsg', 'shareCloseBtn']) {
  check(`share modal element #${id} exists`, htmlIds.has(id));
}
check('shareProfile fills the visible link input', /\$\('shareLinkInput'\)\.value = url/.test(script));
check('shareProfile opens the share modal via openModal', /openModal\('shareModal', 'shareLinkInput'\)/.test(script));
check('share copy button has a clipboard fallback (select)', /shareCopyBtn[\s\S]*?\.select\(\)/.test(script));
// 11c. Bug 3 — future slots cannot be marked early
check('future slots are computed from the slot hour vs now (hoisted hr)', /const hr = new Date\(\)\.getHours\(\);/.test(script) && /const future = SLOT_HOURS\[slot\] > hr;/.test(script));
check('Taken button is disabled for future slots', /takenDis = status === 'taken' \|\| future/.test(script));
check('Missed button is disabled for future slots', /missedDis = status === 'missed' \|\| future/.test(script));
// 11d. Bug 4 — dose row keeps a space between name and dose
check('dose row uses a non-breaking space between name and dose', /escapeHtml\(m\.name\)\}&nbsp;<span/.test(script));
// 11e. Bug 5 — Weight shows kg (display only)
check('weight display helper exists', /vitalDisplay/.test(script));
check('vital units map covers Weight kg, Blood Sugar mg/dL, Pulse bpm', /const VITAL_UNITS = \{ 'Blood Sugar': ' mg\/dL', 'Weight': ' kg', 'Pulse': ' bpm' \}/.test(script));
// 11f. Bug 6 — reminders: Overdue label, missed stays visible, dismiss records
check('overdue pending dose uses the rem_overdue label', /t\('rem_overdue'\)/.test(script));
check('explicitly missed dose uses the rem_missed label', /else if \(status === 'missed'\)[\s\S]*?t\('rem_missed'\)/.test(script));
check('overdue needs the 30-minute grace (not 1 minute late)', /nowMins - slotMins > OVERDUE_GRACE_MIN/.test(script));
check('dismissing a miss-* reminder records it in doseLog', /doseLog\[key\] = 'missed'/.test(script));
// 11g. (Round 8) Every delete/reset path confirms first — in-app modal,
//      never a native confirm(). The old native-confirm checks are gone
//      with the dialogs themselves.
check('deleteMed routes through the shared deleteEntity', /function deleteMed\(id\) \{ deleteEntity\('medicines', id, 'delete_med_title', 'delete_med_text'\); \}/.test(script));
check('deleteAppt routes through the shared deleteEntity', /function deleteAppt\(id\) \{ deleteEntity\('appointments', id, 'delete_appt_title', 'delete_appt_text'\); \}/.test(script));
check('deleteMember routes through the shared deleteEntity', /function deleteMember\(id\) \{ deleteEntity\('circle', id, 'delete_member_title', 'delete_member_text'\); \}/.test(script));
check('deleteEntity confirms via the in-app modal', /function deleteEntity[\s\S]*?askConfirm\(t\(titleKey\), t\(textKey\), t\('confirm_ok'\)/.test(script));
check('resetDemo confirms via the in-app modal', /function resetDemo\(\) \{[\s\S]*?askConfirm\(t\('reset_title'\), t\('reset_text'\), t\('confirm_ok'\)/.test(script));
check('no native confirm() calls remain in the script', !/\bconfirm\(/.test(scriptNoComments));

// 12. Fix round 3 (15 Nov): setup-screen sample entry, persisted
//     dismissals, signed-in lock-screen hint
// 12a. A fresh visitor only ever sees the setup screen, so the sample
//      profile must be reachable from there too — same shared path.
check('setup screen sample button exists', htmlIds.has('setupSampleBtn'));
check('setup sample button sits inside the setup screen', /id="setupScreen"[\s\S]*?id="setupSampleBtn"/.test(html));
check('shared loadSampleProfile function exists', /function loadSampleProfile\(\)/.test(script));
check('lock-screen sample button uses the shared function', /\$\('sampleProfileBtn'\)\.onclick = loadSampleProfile/.test(script));
check('setup-screen sample button uses the shared function', /\$\('setupSampleBtn'\)\.onclick = loadSampleProfile/.test(script));
check('sample load opens the modal directly (no native confirm guard)', /function loadSampleProfile\(\) \{\s*openSamplePassModal\(\);\s*\}/.test(script));
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
// (Round 8) The old check only proved the word "dismissed" did not
// appear in a string slice of syncPush — vacuous. Assert on the real
// function body, brace-matched: the PUT payload is exactly the 5 data
// fields, nothing else.
const syncPushFn = extractFn(script, 'async syncPush()');
check('syncPush source extracted for the payload audit', syncPushFn.length > 0);
check('syncPush PUT payload is exactly the 5 data fields', /JSON\.stringify\(\{ medicines, appointments, circle, vitals, doseLog \}\)/.test(syncPushFn));
check('syncPush payload never includes the passcode', !/passcode/.test(syncPushFn));
check('syncPush payload never includes dismissals', !/dismissed/i.test(syncPushFn));
check('resetDemo clears persisted dismissals', /function resetDemo[\s\S]*?localStorage\.removeItem\(DISMISSED_KEY\)[\s\S]*?dismissedReminders\.clear\(\)/.test(script));
// 12c. Lock screen explains the two locks when signed in
check('signed-in hint element exists', htmlIds.has('lockSignedInHint'));
check('hint sits under the signed-in state line', /id="lockAuthState"[\s\S]*?id="lockSignedInHint"/.test(html));
check('hint is shown when signed in', /function refreshLockAuthUI[\s\S]*?\$\('lockSignedInHint'\)\.style\.display = email \? 'block' : 'none'/.test(script));
check('hint English text present', /lock_signedin_hint: "You're signed in for cloud sync — enter your 4-digit passcode to open this profile\."/.test(script));
check('hint Hindi text present', /lock_signedin_hint: "आप क्लाउड सिंक के लिए साइन इन हैं — प्रोफ़ाइल खोलने के लिए अपना 4 अंकों का पासकोड डालें।"/.test(script));
check('auth flow is unchanged (no auto-unlock on sign-in)', !/authSignIn[\s\S]*?unlockBtn['"]\)\.click/.test(script));

// 13. Round 4: passcode is the front door, unlock remembered per session
// 13a. Lock-screen hierarchy: passcode first, sign-in a small secondary link
check('passcode input + Unlock come before the sign-in link', /id="passInput"[\s\S]*?id="unlockBtn"[\s\S]*?id="lockAuthBtn"/.test(html));
check('sign-in on the lock screen is a text link, not a primary button', /<button id="lockAuthBtn" type="button" class="text-teal-700 underline"/.test(html));
check('lock-screen sign-in link has no primary-button styling', !/id="lockAuthBtn"[^>]*bg-\[#0F766E\]/.test(html));
check('sign-in link sits inside the lock screen', /id="lockScreen"[\s\S]*?id="lockAuthBtn"/.test(html));
check('sign-in link English text present', /lock_signin_link: "Want this profile on another device\? Sign in for cloud sync"/.test(script));
check('sign-in link Hindi text present', /lock_signin_link: "यह प्रोफ़ाइल दूसरे डिवाइस पर चाहिए\? क्लाउड सिंक के लिए साइन इन करें"/.test(script));
check('old primary sign-in label is gone', !/lock_signin: "Sign in \/ Create account"/.test(script));
check('old or-passcode divider key is gone', !/lock_or_passcode:/.test(script));
// 13b. Remember unlock for the browser session (sessionStorage, per-tab)
check('session unlock key defined', /const UNLOCKED_KEY = 'sahayakcare_unlocked'/.test(script));
check('isUnlockedSession helper exists', /function isUnlockedSession\(\)/.test(script));
check('setUnlockedSession helper exists', /function setUnlockedSession\(\)/.test(script));
check('clearUnlockedSession helper exists', /function clearUnlockedSession\(\)/.test(script));
check('flag is stored in sessionStorage (per-tab), not localStorage', /sessionStorage\.setItem\(UNLOCKED_KEY, '1'\)/.test(script) && !/localStorage\.(setItem|getItem|removeItem)\(UNLOCKED_KEY/.test(script));
check('openApp helper shows the app directly', /function openApp\(\) \{[\s\S]*?\$\('app'\)\.style\.display = 'block'/.test(script));
const unlockFn = (script.match(/\$\('unlockBtn'\)\.onclick = \(\) => \{[\s\S]*?\n\};/) || [])[0] || '';
check('successful unlock sets the session flag', /setUnlockedSession\(\)/.test(unlockFn));
check('successful unlock opens the app', /openApp\(\)/.test(unlockFn));
check('wrong passcode still shows the error', /lockError/.test(unlockFn));
check('boot skips the lock screen when unlocked this session', /function showBootScreen\(\) \{[\s\S]*?isUnlockedSession\(\)[\s\S]*?openApp\(\)/.test(script));
check('Lock button clears the session flag', /\$\('lockBtn'\)\.onclick = \(\) => \{ clearUnlockedSession\(\); showBootScreen\(\); \}/.test(script));
check('lock-screen sign-out clears the session flag', /\$\('lockSignOutBtn'\)\.onclick = \(\) => \{ api\.token = ''; clearUnlockedSession\(\); refreshAuthUI\(\); \}/.test(script));
check('auth-modal sign-out clears the session flag', /\$\('authSignOut'\)\.onclick = \(\) => \{[\s\S]*?clearUnlockedSession\(\)/.test(script));
check('setupSubmit clears the session flag (new profile, new passcode)', /\$\('setupSubmit'\)\.onclick = \(\) => \{[\s\S]*?clearUnlockedSession\(\)/.test(script));
check('sample load clears the session flag (in the sample save handler)', /\$\('samplePassSave'\)\.onclick = \(\) => \{[\s\S]*?clearUnlockedSession\(\)/.test(script));
check('resetDemo clears the session flag', /function resetDemo[\s\S]*?clearUnlockedSession\(\)/.test(script));
check('sign-in returns to the boot screen (passcode still required)', /\$\('authSignIn'\)\.onclick = async \(\) => \{[\s\S]*?showBootScreen\(\)/.test(script));

// 14. Round 5: create-account starts FRESH — a new cloud account must
//     never inherit the local profile already on the device. Sign-in
//     keeps its pull-first / push-if-nothing path (round 1 rule).
const signUpFn = (script.match(/\$\('authSignUp'\)\.onclick = async \(\) => \{[\s\S]*?\n\};/) || [])[0] || '';
const resetFn = (script.match(/function resetLocalForNewAccount\(\) \{[\s\S]*?\n\}/) || [])[0] || '';
check('resetLocalForNewAccount helper exists', /function resetLocalForNewAccount\(\) \{/.test(script));
check('reset helper discards the local profile via emptyState()', /function resetLocalForNewAccount\(\) \{[\s\S]*?state = emptyState\(\);/.test(script));
check('reset helper removes the saved profile from localStorage', /function resetLocalForNewAccount\(\) \{[\s\S]*?localStorage\.removeItem\('sahayakcare_v1'\)/.test(script));
check('reset helper clears persisted dismissals', /function resetLocalForNewAccount\(\) \{[\s\S]*?localStorage\.removeItem\(DISMISSED_KEY\)[\s\S]*?dismissedReminders\.clear\(\)/.test(script));
check('reset helper clears the session unlock flag', /function resetLocalForNewAccount\(\) \{[\s\S]*?clearUnlockedSession\(\)/.test(script));
check('reset helper asks for no confirmation (create-account just opens fresh)', !/confirm\(/.test(resetFn));
check('sign-up calls resetLocalForNewAccount after login', /resetLocalForNewAccount\(\);/.test(signUpFn));
check('sign-up no longer pushes the old local data to the new account', !/syncPush/.test(signUpFn));
check('sign-up does not reuse the sign-in sync path', !/syncAfterSignIn/.test(signUpFn));
check('sign-up reset happens only after a successful login (token set)', /api\.token = login\.data\.access_token;[\s\S]*?resetLocalForNewAccount\(\);/.test(signUpFn));
check('sign-up shows the setup screen right after the reset (even if the app was open)', /resetLocalForNewAccount\(\);[\s\S]*?showBootScreen\(\);/.test(signUpFn));
check('setupSubmit still saves (fresh profile syncs to the new account)', /\$\('setupSubmit'\)\.onclick = \(\) => \{[\s\S]*?clearUnlockedSession\(\);\s*save\(\);/.test(script));

// 15. Round 6: the sample profile has NO preset passcode — it opens
//     with a passcode the user sets in an in-app modal (Aman: "default
//     1234 passcode still there, it should open with their passcode").
check('sample note element (with the 1234 hint) is gone', !htmlIds.has('sampleNote'));
check('sampleData takes the user-set passcode as a parameter', /function sampleData\(passcode\)/.test(script));
check('sampleData stores the HASH of the passed-in passcode', /function sampleData\(passcode\)[\s\S]*?state\.passcode = hashPasscode\(passcode\);/.test(script));
check('sample passcode modal exists', htmlIds.has('samplePassModal'));
for (const id of ['samplePass', 'samplePassConfirm', 'samplePassError', 'samplePassSave', 'samplePassCancel']) {
  check(`sample passcode modal field #${id} exists`, htmlIds.has(id));
}
check('sample load is exactly open-the-modal (no guard of any kind)', /function loadSampleProfile\(\) \{\s*openSamplePassModal\(\);\s*\}/.test(script));
const sampleSaveFn = (script.match(/\$\('samplePassSave'\)\.onclick = \(\) => \{[\s\S]*?\n\};/) || [])[0] || '';
check('sample modal validates via the shared validatePasscode', /const passErr = validatePasscode\(pass, confirmPass\)/.test(sampleSaveFn));
check('validatePasscode enforces 4 digits + non-trivial + match', /function validatePasscode\(pass, confirmPass\)[\s\S]*?\/\^\\d\{4\}\$\/[\s\S]*?TRIVIAL_PASSCODES\.includes\(pass\)[\s\S]*?pass !== confirmPass/.test(script));
check('sample modal shows an inline error (never a native dialog)', /samplePassError/.test(sampleSaveFn) && !/alert\(|prompt\(/.test(sampleSaveFn));
check('sample modal loads the sample with the user-set passcode', /sampleData\(pass\)/.test(sampleSaveFn));
check('sample modal signs out first (sample never overwrites the cloud backup)', /api\.token = ''/.test(sampleSaveFn));
check('sample modal opens the dashboard directly after setting the passcode', /setUnlockedSession\(\)[\s\S]*?openApp\(\)/.test(sampleSaveFn));
check('modal registry covers all 9 modals incl. confirm + shareImport', /const MODAL_IDS = \['medModal', 'apptModal', 'memberModal', 'authModal', 'passModal', 'shareModal', 'samplePassModal', 'confirmModal', 'shareImportModal'\]/.test(script));
check('sample passcode modal is in the Escape close list', /'samplePassModal'/.test(script));
check('sample modal i18n: hint in English', /sample_pass_hint: "Choose your own 4-digit passcode to open this sample profile\. Nothing is preset — you pick it\. Loading it replaces the profile on this device\."/.test(script));
check('sample modal i18n: hint in Hindi', /sample_pass_hint: "इस नमूना प्रोफ़ाइल को खोलने के लिए अपना 4 अंकों का पासकोड चुनें। कुछ भी पहले से तय नहीं है — आप खुद चुनें। इसे खोलने पर इस डिवाइस की प्रोफ़ाइल बदल जाएगी।"/.test(script));
check('sample modal i18n: open button in English', /sample_pass_open: "Open sample profile"/.test(script));
check('sample modal i18n: open button in Hindi', /sample_pass_open: "नमूना प्रोफ़ाइल खोलें"/.test(script));

// 16. Round 7: the round-6 sample button was DEAD in a real browser —
//     loadSampleProfile() called native confirm() first, and automated
//     browsers auto-dismiss confirm() as Cancel, so the modal never
//     opened. The guard is gone; the modal's Cancel button is the
//     back-out, and the hint carries the replacement warning.
const sampleFn = (script.match(/function loadSampleProfile\(\) \{[\s\S]*?\n\}/) || [])[0] || '';
const sampleModalFn = (script.match(/function openSamplePassModal\(\) \{[\s\S]*?\n\}/) || [])[0] || '';
check('loadSampleProfile body has no native confirm/prompt/alert', !/confirm\(|prompt\(|alert\(/.test(sampleFn));
check('whole sample path uses no native dialogs (load + modal + save)', !/confirm\(|prompt\(|alert\(/.test((sampleFn + sampleModalFn + sampleSaveFn).replace(/\/\/[^\n]*/g, '')));
check('no "Load the sample profile?" native confirm string remains', !/Load the sample profile\?/.test(script));
check('sample modal Cancel closes via closeModal without loading', /\$\('samplePassCancel'\)\.onclick = \(\) => closeModal\('samplePassModal'\)/.test(script));
check('sample modal hint still warns about replacement in the HTML text', /Loading it replaces the profile on this device/.test(html));

// 17. Fix round 8 (15 Nov): the strict-audit round — hashed passcodes,
//     merge sync, honest sync label, in-app modals, delegation, Tailwind
//     static build, harness + docs.
// 17a. Passcode hashing (SHA-256) + 5-try lockout
check('hashPasscode prefixes with sha256:', /const hashPasscode = pass => 'sha256:' \+ sha256Hex\(String\(pass\)\);/.test(script));
check('verifyPasscode accepts the hash', /function verifyPasscode\(input, stored\)[\s\S]*?hashPasscode\(input\) === stored/.test(script));
check('verifyPasscode still accepts a legacy plaintext passcode once', /function verifyPasscode\(input, stored\)[\s\S]*?return input === stored;/.test(script));
check('legacy plaintext passcodes migrate to a hash on unlock', /function migratePasscodeIfLegacy\(\)/.test(script) && /state\.passcode = hashPasscode\(state\.passcode\)/.test(script));
check('lockout: 5 failed unlocks, 30s lock', /LOCKOUT_AFTER_FAILS = 5/.test(script) && /LOCKOUT_MS = 30000/.test(script));
check('unlock handler enforces the lockout', /lockoutRemainingMs\(\)/.test(unlockFn));
check('unlock handler records failed attempts', /recordFailedUnlock\(\)/.test(unlockFn));
check('unlock handler verifies against the hash', /verifyPasscode\(\$\('passInput'\)\.value, state\.passcode\)/.test(unlockFn));
check('setupSubmit stores the hashed passcode', /passcode: hashPasscode\(pass\)/.test(script));
check('validatePasscode blocks the trivial 0000/1234', /TRIVIAL_PASSCODES\.includes\(pass\)/.test(script));
// 17b. Sync: merge, never blind-replace; honest label; token verified
check('syncPull returns a status, never a bare boolean/null', /async syncPull\(\)[\s\S]*?return \{ status: 'empty'/.test(script));
check('syncPull merges cloud state (never blind-replaces)', /function mergeCloudState/.test(script) && /mergeCloudState\(res\.data\)/.test(script));
check('merge unions lists by id with local winning', /function mergeCloudState[\s\S]*?unionById[\s\S]*?localList[\s\S]*?byId\.set\(item\.id, item\)/.test(script));
check('merge unions doseLog by key with local winning', /state\.doseLog = \{ \.\.\.\(cloud\.doseLog \|\| \{\}\), \.\.\.state\.doseLog \}/.test(script));
check('save() debounces the cloud push (500ms)', /scheduleSyncPush/.test(script) && /setTimeout\(\(\) => \{ doSyncPush\(\); \}, 500\)/.test(script));
check('api.call returns {ok, status, data} — never a bare null', /async call\(path, options\)[\s\S]*?return \{ ok: res\.ok, status: res\.status, data:/.test(script));
check('api.call maps a network failure to status 0', /catch \(e\) \{ return \{ ok: false, status: 0, data: null \};?\s*\}/.test(script));
check('every fetch has a 15s timeout', /FETCH_TIMEOUT_MS = 15000/.test(script) && /function fetchWithTimeout/.test(script));
check('boot verifies the stored token via /api/auth/me', /api\.call\('\/api\/auth\/me'\)/.test(script));
check('a 401 at boot clears the token (dead free-tier account)', /res\.status === 401[\s\S]*?api\.token = ''/.test(script));
check('syncAfterUnlock exists and merges after unlock', /async function syncAfterUnlock\(\)/.test(script));
// 17c. Load validation + share-import modal + corrupted storage
check('load() defers a share import when a local profile exists', /pendingShared = shared/.test(script));
check('share import asks in-app (no silent overwrite)', /function maybeShowShareImport\(\)/.test(script) && /openModal\('shareImportModal'/.test(script));
check('corrupted storage shows the boot notice instead of silently wiping', /bootCorrupted/.test(script) && /\$\('bootNotice'\)\.textContent = t\('boot_corrupted'\)/.test(script));
check('load() normalises saved state through validateSharedState', /state = normalizeState\(JSON\.parse\(data\)\)/.test(script));
check('setupSubmit validates age 1–130', /ageNum < 1 \|\| ageNum > 130/.test(script));
check('setupSubmit uses the shared validatePasscode', /const passErr = validatePasscode\(pass, confirmPass\)/.test(script));
// 17d. Sample two-step confirm (replaces the dead native confirm)
check('sample confirm block exists in the HTML', htmlIds.has('sampleConfirmBlock') && htmlIds.has('sampleConfirmCheck') && htmlIds.has('sampleConfirmText'));
check('sample modal shows the replace warning only when a profile exists', /function openSamplePassModal\(\)[\s\S]*?hasLocalProfile\(\)/.test(script));
check('sample save requires the checkbox when a profile exists', /sampleConfirmCheck'\)\.checked/.test(sampleSaveFn));
// 17e. Modals: one system, focus trap, no native dialogs
check('openModal/closeModal/askConfirm exist', /function openModal\(id, focusId\)/.test(script) && /function closeModal\(id\)/.test(script) && /function askConfirm\(title, text, okLabel, onOk\)/.test(script));
check('Escape closes the topmost modal', /e\.key === 'Escape'/.test(script) && /closeModal\(open\[open\.length - 1\]\)/.test(script));
check('Tab is trapped inside the open modal', /e\.key === 'Tab'/.test(script));
check('closing the auth modal cancels a cold-start retry', /if \(id === 'authModal'\) authCancelled = true/.test(script));
check('no modal is shown/hidden by direct style.display', !/Modal'\)\.style\.display/.test(script));
check('no native prompt()/alert() calls remain', !/\bprompt\(/.test(scriptNoComments) && !/\balert\(/.test(scriptNoComments));
// 17f. Event delegation replaces all inline handlers
check('no inline onclick="..." attributes remain in the HTML', !/\sonclick="/.test(html));
check('one delegated click listener routes data-action clicks', /\$\('app'\)\.addEventListener\('click'/.test(script) && /closest\('\[data-action\]'\)/.test(script));
for (const a of ['mark-dose', 'edit-med', 'delete-med', 'edit-appt', 'delete-appt', 'edit-member', 'delete-member', 'approve-member', 'edit-vital', 'delete-vital', 'dismiss-reminder', 'add-caretaker']) {
  check(`renderer emits data-action="${a}"`, script.includes(`data-action="${a}"`));
}
check('delegation routes mark-dose', /action === 'mark-dose'\) markDose\(id, slot, status\)/.test(script));
check('upsertEntity pushes when findIndex is -1 (no silent drop)', /function upsertEntity[\s\S]*?if \(idx >= 0\) \{ list\[idx\] = data; return; \}[\s\S]*?list\.push\(data\)/.test(script));
check('edit handlers bail out when the record is gone', /function editMed\(id\) \{[\s\S]*?if \(!m\) return;/.test(script) && /function editAppt\(id\) \{[\s\S]*?if \(!a\) return;/.test(script) && /function editMember\(id\) \{[\s\S]*?if \(!c\) return;/.test(script));
check('medSave refuses a medicine with no time slots', /med_no_slots/.test(script));
check('medSave stores blank stock as null (not tracked)', /stock: stockVal === '' \? null/.test(script));
check('memberSave validates the email before storing it', /EMAIL_RE\.test\(email\)/.test(script));
// 17g. Adherence, stock, reminders, vitals
check('getAdherence returns pct null with no data', /const pct = total \? Math\.round\(\(taken \/ total\) \* 100\) : null/.test(script));
check('dashboard shows a dash when pct is null', /if \(adh\.pct === null\)/.test(script));
check('adherence ring uses the exact circumference constant', /RING_CIRCUMFERENCE = 339\.29/.test(script) && /stroke-dasharray="\$\{RING_CIRCUMFERENCE\}"/.test(script));
check('no magic 339 remains in the ring math', !/339 -/.test(script));
check('re-marking Taken→Missed restores one unit of stock', /status === 'missed' && prev === 'taken'[\s\S]*?med\.stock\+\+/.test(script));
check('overdue grace constant is 30 minutes', /OVERDUE_GRACE_MIN = 30/.test(script));
check('due-soon window is 2 hours, minute-precise', /slotMins - nowMins <= DUE_SOON_HOURS \* 60/.test(script));
check('pending members never receive reminders', /c\.status !== 'pending'/.test(script));
check('zero-slot medicine shows a no-schedule chip', /no_schedule/.test(script));
check('vital edit mode exists (vitalEditId)', /let vitalEditId = null/.test(script) && /function editVital\(id\)/.test(script));
check('vital ranges are validated (BP 120/80 format, sane bounds)', /function validateVital\(type, val\)/.test(script) && /vital_bp_format/.test(script));
check('renderAll renders only the active tab', /if \(currentTab === 'dashboard'\) renderDashboard\(\);/.test(script));
check('renderAll restores focus after a re-render', /focusAction/.test(script));
// 17h. Tailwind is static + inlined — no CDN at runtime
check('no Tailwind Play CDN script tag remains', !/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/.test(html));
check('no external scripts remain at all', !/<script src=/.test(html));
check('inlined Tailwind CSS is present (v3.4.17)', /tailwindcss v3\.4\.17/.test(html));
check('inlined CSS defines bg-teal-700', /\.bg-teal-700\{/.test(html));
// 17i. Harness exists and is wired into package.json
check('tests/harness.js exists', fs.existsSync('tests/harness.js'));
check('package.json test runs test.js + harness', /"test":\s*"node test\.js && node tests\/harness\.js"/.test(fs.readFileSync('package.json', 'utf8')));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
