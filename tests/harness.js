// Fix-round-8 dynamic harness: executes the REAL index.html script in a
// stub-DOM vm context and drives the flows the static checks cannot see:
//   - sample tap -> modal -> load (with the new two-step confirm checkbox)
//   - auth 401 vs 5xx vs null (network) at sign-in
//   - sync pull/push: pull 404 -> push local; pull network-failure -> MUST
//     NOT push; pull 401 -> the label is never "Synced"
//   - offline fallback + dose flow while the backend sleeps
//   - corrupted-storage boot notice
//   - change-passcode (hashed) + legacy plaintext migration + lockout
//   - share import (direct / ask-first / crafted-link validation)
//   - delegation clicks (synthetic event with closest()/dataset)
//   - fetch-spy contract: login form-urlencoded, register JSON, state PUT
//     sends exactly the 5 data fields, never the passcode
// The stub DOM is deliberately thin, but it is honest about the two
// things round 7 got wrong: native confirm() defaults to FALSE (the
// condition that killed the round-6 sample button), and the med-time
// checkboxes are real persistent elements (medSave refuses a medicine
// with no slots, so a stub that returns no checkboxes would make every
// add-medicine flow fail for the wrong reason).
// Run with: node tests/harness.js
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

let failures = 0;
function check(name, ok) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
  if (!ok) failures++;
}

const tick = (ms = 50) => new Promise(r => setTimeout(r, ms == null ? 50 : ms));

function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  };
}

// The stub element the app renders into. focus() tracks document.activeElement
// so renderAll()'s focus-restore can be observed.
let activeDoc = null;
function makeEl(id) {
  const el = {
    id: id || '',
    style: {},
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    checked: false,
    type: '',
    dataset: {},
    children: [],
    _listeners: {},
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    querySelector() { return makeEl(''); },
    querySelectorAll() { return []; },
    focus() { if (activeDoc) activeDoc.activeElement = el; },
    select() {}, remove() {},
    closest(sel) { return (sel === '[data-action]' && this.dataset && this.dataset.action) ? this : null; },
    matches() { return false; },
    click() {
      if (typeof this.onclick === 'function') this.onclick();
      for (const fn of (this._listeners.click || [])) fn({ target: this, preventDefault() {} });
    },
    onclick: null,
  };
  // The real DOM coerces input.value / textContent to strings on
  // assignment (setupAge is prefilled with a NUMBER age); the stub
  // must too, or .trim()/.includes() on a stored number throws.
  let _value = '', _text = '';
  Object.defineProperty(el, 'value', { get: () => _value, set: v => { _value = (v === null || v === undefined) ? '' : String(v); }, enumerable: true, configurable: true });
  Object.defineProperty(el, 'textContent', { get: () => _text, set: v => { _text = (v === null || v === undefined) ? '' : String(v); }, enumerable: true, configurable: true });
  return el;
}

// ---- Fake backend: the real API contract, in-memory ----
// Users are email -> { name, password, state }. Tokens are JWT-shaped
// (header.payload.sig) so the app's emailFromToken() decodes them.
function makeServer() {
  const users = new Map();
  const calls = [];
  let sleeping = false;
  let failGetState = false;
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
  const tokenFor = email => `x.${b64({ sub: email })}.sig`;
  const emailFromAuth = headers => {
    const h = (headers && (headers.Authorization || headers.authorization)) || '';
    if (!h.startsWith('Bearer ')) return null;
    try { return JSON.parse(Buffer.from(h.slice(7).split('.')[1], 'base64').toString('utf8')).sub || null; }
    catch (e) { return null; }
  };
  const resp = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  async function fetch(url, options = {}) {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = (options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    let bodyText = '';
    if (typeof options.body === 'string') bodyText = options.body;
    else if (options.body && typeof options.body.toString === 'function') bodyText = options.body.toString();
    calls.push({ method, path, headers: { ...headers }, body: bodyText });
    if (sleeping) throw new Error('network down (server asleep)');
    if (path === '/api/auth/register' && method === 'POST') {
      const b = JSON.parse(bodyText);
      if (users.has(b.email)) return resp(400, { detail: 'Could not create the account' });
      users.set(b.email, { name: b.name, password: b.password, state: null });
      return resp(201, { email: b.email });
    }
    if (path === '/api/auth/login' && method === 'POST') {
      const p = new URLSearchParams(bodyText);
      const u = users.get(p.get('username'));
      if (!u || u.password !== p.get('password')) return resp(401, { detail: 'Incorrect email or password' });
      return resp(200, { access_token: tokenFor(p.get('username')), token_type: 'bearer' });
    }
    const email = emailFromAuth(headers);
    if (path === '/api/auth/me' && method === 'GET') {
      if (!email || !users.has(email)) return resp(401, { detail: 'Not authenticated' });
      return resp(200, { email });
    }
    if (path === '/api/state' && method === 'GET') {
      if (failGetState) throw new Error('network down on GET /api/state');
      if (!email || !users.has(email)) return resp(401, { detail: 'Not authenticated' });
      const st = users.get(email).state;
      if (!st) return resp(404, { detail: 'No state saved yet' });
      return resp(200, JSON.parse(JSON.stringify(st)));
    }
    if (path === '/api/state' && method === 'PUT') {
      if (!email || !users.has(email)) return resp(401, { detail: 'Not authenticated' });
      users.get(email).state = JSON.parse(bodyText);
      return resp(200, {});
    }
    return resp(404, { detail: 'not found' });
  }
  return {
    users, calls, fetch, tokenFor,
    get sleeping() { return sleeping; }, set sleeping(v) { sleeping = v; },
    get failGetState() { return failGetState; }, set failGetState(v) { failGetState = v; },
    addUser(email, name, password, state) { users.set(email, { name, password, state: state || null }); },
    getState(email) { const u = users.get(email); return u && u.state ? JSON.parse(JSON.stringify(u.state)) : null; },
  };
}

function runApp({ local, session, server, hash = '' }) {
  const els = new Map();
  const docListeners = {};
  // The med-time checkboxes are real persistent elements: medSave refuses
  // a medicine with no slots, so the stub must let a test tick one.
  const medCheckboxes = ['morning', 'afternoon', 'evening', 'night'].map(slot => {
    const el = makeEl('cb-' + slot);
    el.value = slot; el.checked = false; el.type = 'checkbox';
    return el;
  });
  const documentStub = {
    getElementById: id => {
      if (!els.has(id)) els.set(id, makeEl(id));
      return els.get(id);
    },
    querySelectorAll: sel => {
      if (typeof sel === 'string' && sel.includes('medTimeCheckboxes')) {
        return sel.includes(':checked') ? medCheckboxes.filter(c => c.checked) : [...medCheckboxes];
      }
      return [];
    },
    querySelector: () => makeEl(''),
    createElement: () => makeEl(''),
    addEventListener: (ev, fn) => { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    body: makeEl('body'),
    documentElement: { lang: 'en', classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } } },
    activeElement: null,
    title: '',
  };
  activeDoc = documentStub;
  const fetchStub = server ? server.fetch : async () => ({ ok: false, status: 404, json: async () => ({}) });
  let confirmReturn = false;
  const confirmCalls = [];
  const alertCalls = [];
  const promptCalls = [];
  const sandbox = {
    console,
    document: documentStub,
    localStorage: local,
    sessionStorage: session,
    location: { origin: 'https://test.local', pathname: '/', href: 'https://test.local/' + hash, hash },
    history: { replaceState() {} },
    navigator: {},
    confirm: msg => { confirmCalls.push(msg); return confirmReturn; },
    alert: msg => { alertCalls.push(msg); },
    prompt: msg => { promptCalls.push(msg); return null; },
    fetch: fetchStub,
    setTimeout, clearTimeout,
    atob: s => Buffer.from(s, 'base64').toString('utf8'),
    btoa: s => Buffer.from(s, 'utf8').toString('base64'),
    URLSearchParams,
    // Round 8 needs these globals inside the vm context (share links use
    // TextEncoder/TextDecoder; fetchWithTimeout uses AbortController).
    TextEncoder, TextDecoder, Uint8Array, DataView, AbortController,
    Date, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Promise,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const id of new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]))) {
    if (!(id in sandbox)) {
      Object.defineProperty(sandbox, id, { value: documentStub.getElementById(id), configurable: true });
    }
  }
  vm.runInContext(script, sandbox);
  for (const fn of (docListeners.DOMContentLoaded || [])) fn();
  const savedState = () => JSON.parse(local.getItem('sahayakcare_v1') || 'null');
  // Evaluate code inside the app's own scope (lets the harness read
  // `state`, `syncState`, `verifyPasscode(...)` — lexical bindings the
  // sandbox object itself does not expose).
  const ev = code => { try { return vm.runInContext(code, sandbox); } catch (e) { return undefined; } };
  // Fire a synthetic click on the app root for a fake button, the way a
  // real browser bubbles a click from a data-action button.
  const fireAppClick = dataset => {
    const fake = makeEl('fake-btn');
    fake.dataset = { ...dataset };
    for (const fn of (els.get('app')._listeners.click || [])) fn({ target: fake, preventDefault() {} });
    return fake;
  };
  return {
    sandbox, els, confirmCalls, alertCalls, promptCalls, savedState, ev, fireAppClick,
    medCheckboxes, setConfirm: v => { confirmReturn = v; },
  };
}

const OLD_PROFILE = {
  profileName: 'Old Elder', profileAge: 80,
  medicines: [{ id: 'm-old', name: 'Metformin', dose: '500 mg', times: ['morning'], purpose: '', stock: 18, notes: '', createdAt: '2026-11-15' }],
  appointments: [{ id: 'a-old', doctor: 'Dr. Old', specialty: 'GP', date: '2026-11-20', time: '10:00', place: 'Clinic', notes: '' }],
  circle: [{ id: 'c-old', name: 'Old Kin', role: 'Family', phone: '+91 1', email: 'old@example.com', status: 'approved' }],
  vitals: [{ id: 'v-old', type: 'Weight', value: '70', date: '2026-11-14', note: '' }],
  doseLog: { '2026-11-15|m-old|morning': 'taken' },
  passcode: '1111', sample: false,
};
const emptyCloudState = () => ({ medicines: [], appointments: [], circle: [], vitals: [], doseLog: {} });
const today = () => new Date().toISOString().slice(0, 10);

async function flowA() {
  // Fresh device, setup-screen sample link: full journey with the modal.
  const local = makeStorage(); const session = makeStorage();
  const app = runApp({ local, session });
  check('A0 fresh device shows the setup screen', app.els.get('setupScreen').style.display === 'flex');
  app.els.get('setupSampleBtn').click();
  await tick();
  check('A1 sample tap opens the passcode modal (not a native prompt)',
    app.els.get('samplePassModal').style.display === 'flex');
  check('A1b no profile exists, so the replace-confirm block stays hidden',
    app.els.get('sampleConfirmBlock').style.display === 'none');
  check('A2 sample is NOT loaded before a passcode is set',
    app.savedState() === null && app.els.get('app').style.display !== 'block');
  // Too short
  app.els.get('samplePass').value = '12';
  app.els.get('samplePassConfirm').value = '12';
  app.els.get('samplePassSave').click();
  await tick();
  check('A3 non-4-digit passcode shows an inline error, modal stays open',
    app.els.get('samplePassError').style.display === 'block'
    && app.els.get('samplePassModal').style.display === 'flex'
    && app.savedState() === null);
  // Trivial passcode (round 8: 1234 is rejected, not a default)
  app.els.get('samplePass').value = '1234';
  app.els.get('samplePassConfirm').value = '1234';
  app.els.get('samplePassSave').click();
  await tick();
  check('A3b trivial passcode 1234 is rejected with an inline error',
    app.els.get('samplePassError').style.display === 'block'
    && app.els.get('samplePassModal').style.display === 'flex'
    && app.savedState() === null);
  // Mismatch
  app.els.get('samplePass').value = '7890';
  app.els.get('samplePassConfirm').value = '0987';
  app.els.get('samplePassSave').click();
  await tick();
  check('A4 mismatched passcodes show an inline error, sample still not loaded',
    app.els.get('samplePassError').style.display === 'block'
    && app.els.get('samplePassModal').style.display === 'flex'
    && app.savedState() === null);
  // Valid
  app.els.get('samplePass').value = '7890';
  app.els.get('samplePassConfirm').value = '7890';
  app.els.get('samplePassSave').click();
  await tick();
  const st = app.savedState();
  check('A5 valid passcode loads the sample with THAT passcode (not 1234)',
    st && st.profileName === 'Shanti Devi' && st.sample === true && st.medicines.length === 4);
  check('A5b the stored passcode is a SHA-256 hash, never plaintext',
    st && typeof st.passcode === 'string' && st.passcode.startsWith('sha256:') && st.passcode !== '7890');
  check('A5c verifyPasscode accepts the user-set passcode against the hash',
    app.ev('verifyPasscode("7890", state.passcode)') === true);
  check('A6 sample opens the dashboard directly (no re-type on the lock screen)',
    app.els.get('app').style.display === 'block'
    && app.els.get('samplePassModal').style.display === 'none');
  check('A7 session unlock flag is set after the sample opens',
    session.getItem('sahayakcare_unlocked') === '1');
  check('A8 sample banner shows', app.els.get('sampleBanner').style.display === 'block');
  // Lock, then unlock with the set passcode; 1234 must be rejected.
  app.els.get('lockBtn').click();
  await tick();
  check('A9 Lock shows the lock screen again',
    app.els.get('lockScreen').style.display === 'flex' && app.els.get('app').style.display !== 'block');
  app.els.get('passInput').value = '1234';
  app.els.get('unlockBtn').click();
  await tick();
  check('A10 the old default 1234 is REJECTED on the sample profile',
    app.els.get('lockError').style.display === 'block'
    && app.els.get('app').style.display !== 'block');
  app.els.get('passInput').value = '7890';
  app.els.get('unlockBtn').click();
  await tick();
  check('A11 the user-set passcode 7890 unlocks', app.els.get('app').style.display === 'block');
  // Fresh tab: new session storage, same local storage — lock screen gates.
  const session2 = makeStorage();
  const app2 = runApp({ local, session: session2 });
  check('A12 fresh tab shows the lock screen (session flag is per-tab)',
    app2.els.get('lockScreen').style.display === 'flex' && app2.els.get('app').style.display !== 'block');
  app2.els.get('passInput').value = '7890';
  app2.els.get('unlockBtn').click();
  await tick();
  check('A13 fresh tab unlocks with the set passcode', app2.els.get('app').style.display === 'block');
  // Change passcode works on the sample profile afterwards (hashed).
  app2.els.get('changePassBtn').click();
  await tick();
  app2.els.get('passOld').value = '7890';
  app2.els.get('passNew').value = '5555';
  app2.els.get('passConfirm').value = '5555';
  app2.els.get('passSave').click();
  await tick();
  const st2 = app2.savedState();
  check('A14 change-passcode stores a hash (current = set passcode)',
    st2 && st2.passcode.startsWith('sha256:') && app2.ev('verifyPasscode("5555", state.passcode)') === true);
  // Wrong current passcode: rejected, stored hash unchanged.
  app2.els.get('changePassBtn').click();
  await tick();
  app2.els.get('passOld').value = '0000';
  app2.els.get('passNew').value = '9999';
  app2.els.get('passConfirm').value = '9999';
  app2.els.get('passSave').click();
  await tick();
  check('A14b wrong current passcode is rejected, hash unchanged',
    app2.els.get('passError').style.display === 'block'
    && app2.ev('verifyPasscode("5555", state.passcode)') === true);
  app2.els.get('passCancel').click();
  await tick();
  app2.els.get('lockBtn').click();
  await tick();
  app2.els.get('passInput').value = '5555';
  app2.els.get('unlockBtn').click();
  await tick();
  check('A15 new passcode 5555 unlocks after the change', app2.els.get('app').style.display === 'block');
}

async function flowB() {
  // Lock-screen sample link with an existing profile. The native
  // confirm() guard is GONE (round 7): clicking must open the modal
  // even though confirm() would return false, and confirm() must
  // never be called at all. Round 8 adds the two-step replace confirm:
  // the modal shows the replace warning and the save needs the checkbox.
  const local = makeStorage(); const session = makeStorage();
  local.setItem('sahayakcare_v1', JSON.stringify(OLD_PROFILE));
  const app = runApp({ local, session });
  check('B0 existing profile shows the lock screen', app.els.get('lockScreen').style.display === 'flex');
  app.els.get('sampleProfileBtn').click();
  await tick();
  check('B1 sample tap opens the passcode modal even with confirm() returning false (round-7 regression)',
    app.els.get('samplePassModal').style.display === 'flex');
  check('B1b the replace warning block IS shown when a profile exists',
    app.els.get('sampleConfirmBlock').style.display === 'block'
    && app.els.get('sampleConfirmText').textContent.length > 10);
  check('B2 no native confirm() was called during the sample tap',
    app.confirmCalls.length === 0);
  check('B3 old profile still intact while the modal is open',
    app.savedState().profileName === 'Old Elder');
  // Save WITHOUT the checkbox: refused, old profile intact.
  app.els.get('samplePass').value = '2468';
  app.els.get('samplePassConfirm').value = '2468';
  app.els.get('samplePassSave').click();
  await tick();
  check('B4 saving without the replace checkbox is refused (two-step confirm)',
    app.els.get('samplePassError').style.display === 'block'
    && app.els.get('samplePassModal').style.display === 'flex'
    && app.savedState().profileName === 'Old Elder');
  // Cancel the modal: nothing loaded.
  app.els.get('samplePassCancel').click();
  await tick();
  check('B5 cancelling the modal loads nothing (old profile intact)',
    app.els.get('samplePassModal').style.display === 'none'
    && app.savedState().profileName === 'Old Elder'
    && app.savedState().medicines[0].id === 'm-old');
  // Valid load (checkbox ticked) replaces the old profile.
  app.els.get('sampleProfileBtn').click();
  await tick();
  check('B6 second tap also opens the modal (confirm() still false)',
    app.els.get('samplePassModal').style.display === 'flex');
  app.els.get('sampleConfirmCheck').checked = true;
  app.els.get('samplePass').value = '2468';
  app.els.get('samplePassConfirm').value = '2468';
  app.els.get('samplePassSave').click();
  await tick();
  const st = app.savedState();
  check('B7 valid sample load replaces the old profile with the sample',
    st && st.profileName === 'Shanti Devi' && st.medicines.length === 4 && st.medicines[0].id === 'm1');
  check('B7b the sample passcode is stored hashed',
    st && st.passcode.startsWith('sha256:') && app.ev('verifyPasscode("2468", state.passcode)') === true);
  check('B8 sample opens the dashboard directly',
    app.els.get('app').style.display === 'block');
  check('B9 confirm() was never called at any point in the sample flow',
    app.confirmCalls.length === 0);
}

async function flowC() {
  // Regression: normal setup still works (passcode set at setup, unlock).
  const local = makeStorage(); const session = makeStorage();
  const app = runApp({ local, session });
  // Trivial passcode at setup is refused (round 8).
  app.els.get('setupName').value = 'Real Elder';
  app.els.get('setupPass').value = '1234';
  app.els.get('setupPassConfirm').value = '1234';
  app.els.get('setupSubmit').click();
  await tick();
  check('C0 setup refuses the trivial passcode 1234',
    app.els.get('setupError').style.display === 'block' && app.savedState() === null);
  // Invalid age is refused.
  app.els.get('setupPass').value = '4321';
  app.els.get('setupPassConfirm').value = '4321';
  app.els.get('setupAge').value = '999';
  app.els.get('setupSubmit').click();
  await tick();
  check('C0b setup refuses an impossible age',
    app.els.get('setupError').style.display === 'block' && app.savedState() === null);
  app.els.get('setupAge').value = '74';
  app.els.get('setupSubmit').click();
  await tick();
  const st = app.savedState();
  check('C1 setup creates a profile with its own passcode (hashed)',
    st && st.profileName === 'Real Elder' && st.profileAge === 74 && st.sample === false
    && st.passcode.startsWith('sha256:') && app.ev('verifyPasscode("4321", state.passcode)') === true);
  check('C2 setup opens the app', app.els.get('app').style.display === 'block');
  app.els.get('lockBtn').click();
  await tick();
  app.els.get('passInput').value = '4321';
  app.els.get('unlockBtn').click();
  await tick();
  check('C3 setup passcode unlocks', app.els.get('app').style.display === 'block');
}

async function flowD() {
  // Legacy plaintext passcode (round-7 profiles) migrates to a hash on
  // first successful unlock — and the 5-try lockout stops guessing.
  const local = makeStorage(); const session = makeStorage();
  local.setItem('sahayakcare_v1', JSON.stringify(OLD_PROFILE)); // passcode '1111' plaintext
  const app = runApp({ local, session });
  app.els.get('passInput').value = '1111';
  app.els.get('unlockBtn').click();
  await tick();
  check('D1 a legacy plaintext passcode still unlocks once',
    app.els.get('app').style.display === 'block');
  const st = app.savedState();
  check('D2 the legacy passcode is migrated to a hash on unlock',
    st && st.passcode.startsWith('sha256:') && st.passcode !== '1111');
  app.els.get('lockBtn').click();
  await tick();
  app.els.get('passInput').value = '1111';
  app.els.get('unlockBtn').click();
  await tick();
  check('D3 the migrated hash still unlocks', app.els.get('app').style.display === 'block');
  // Lockout: 5 wrong attempts, then even the right passcode is refused.
  app.els.get('lockBtn').click();
  await tick();
  for (let i = 0; i < 5; i++) {
    app.els.get('passInput').value = '9999';
    app.els.get('unlockBtn').click();
    await tick();
  }
  check('D4 five wrong attempts trigger the lockout',
    app.ev('lockoutRemainingMs()') > 0);
  app.els.get('passInput').value = '1111';
  app.els.get('unlockBtn').click();
  await tick();
  check('D4b the correct passcode is refused while locked out',
    app.els.get('app').style.display !== 'block'
    && app.els.get('lockError').style.display === 'block');
  // The lockout expires (simulated by clearing the stored lockout, the
  // way the 30s window passing would) and the passcode works again.
  local.removeItem('sahayakcare_lockout_v1');
  app.els.get('passInput').value = '1111';
  app.els.get('unlockBtn').click();
  await tick();
  check('D5 unlock works again after the lockout clears', app.els.get('app').style.display === 'block');
}

async function flowE() {
  // Auth: 401 (wrong password) vs 5xx vs null (backend unreachable) must
  // be told apart — the old code showed "Wrong email or password" for all
  // three. NOTE: a failed first attempt starts a ~50s cold-start retry;
  // the harness asserts the message shown after the FIRST attempt and
  // does not wait the retry out (process.exit ends the run).
  const server = makeServer();
  server.addUser('elder@example.com', 'Elder', 'correct-horse', null);
  // E1: wrong password -> 401, exactly one login attempt, wrong-password text.
  {
    const local = makeStorage(); const session = makeStorage();
    const app = runApp({ local, session, server });
    app.els.get('authEmail').value = 'elder@example.com';
    app.els.get('authPassword').value = 'wrong-password';
    app.els.get('authSignIn').click();
    await tick(300);
    const logins = server.calls.filter(c => c.path === '/api/auth/login');
    check('E1 wrong password shows the wrong-password text (401)',
      app.els.get('authStatus').textContent.includes('Wrong email or password'));
    check('E1 a 401 is never retried (exactly one login call)',
      logins.length === 1);
    check('E1 no token is stored after a 401',
      local.getItem('sahayakcare_token') === null);
  }
  // E2: backend asleep (fetch throws) -> null, wake-up text, no push.
  {
    const callsBefore = server.calls.length;
    const local = makeStorage(); const session = makeStorage();
    local.setItem('sahayakcare_v1', JSON.stringify({ ...OLD_PROFILE, passcode: '1111' }));
    server.sleeping = true;
    const app = runApp({ local, session, server });
    app.els.get('authEmail').value = 'elder@example.com';
    app.els.get('authPassword').value = 'correct-horse';
    app.els.get('authSignIn').click();
    await tick(300);
    check('E2 sleeping backend shows the wake-up text, not wrong-password',
      app.els.get('authStatus').textContent.includes('waking up'));
    check('E2 no state PUT happens when the backend cannot be reached',
      !server.calls.slice(callsBefore).some(c => c.method === 'PUT' && c.path === '/api/state'));
    server.sleeping = false;
  }
  // E3: 5xx on login -> wake-up text too (same retry path as null).
  {
    const flaky = makeServer();
    flaky.addUser('elder@example.com', 'Elder', 'correct-horse', null);
    const realFetch = flaky.fetch;
    let loginCount = 0;
    flaky.fetch = async (url, options) => {
      if (String(url).includes('/api/auth/login') && loginCount++ === 0) {
        return { ok: false, status: 503, json: async () => ({ detail: 'booting' }) };
      }
      return realFetch(url, options);
    };
    const local = makeStorage(); const session = makeStorage();
    const app = runApp({ local, session, server: flaky });
    app.els.get('authEmail').value = 'elder@example.com';
    app.els.get('authPassword').value = 'correct-horse';
    app.els.get('authSignIn').click();
    await tick(300);
    check('E3 a 503 shows the wake-up text, not wrong-password',
      app.els.get('authStatus').textContent.includes('waking up'));
  }
}

async function flowF() {
  // Sync pull/push: the merge rules, including the two failure modes
  // that used to destroy data.
  const server = makeServer();
  const cloudMed = { id: 'm-cloud', name: 'CloudMed', dose: '10 mg', times: ['morning'], purpose: '', stock: 5, notes: '', createdAt: '2026-11-15' };
  const localMed = { id: 'm-local', name: 'LocalMed', dose: '20 mg', times: ['evening'], purpose: '', stock: 7, notes: '', createdAt: '2026-11-15' };
  // F1: pull 404 (account has no state) -> push local up.
  {
    server.addUser('fresh@example.com', 'Fresh', 'pw123456', null);
    const local = makeStorage(); const session = makeStorage();
    const prof = { ...OLD_PROFILE, profileName: 'Fresh Elder', medicines: [localMed], appointments: [], circle: [], vitals: [], doseLog: {} };
    local.setItem('sahayakcare_v1', JSON.stringify(prof));
    const app = runApp({ local, session, server });
    app.els.get('passInput').value = '1111';
    app.els.get('unlockBtn').click();
    await tick();
    app.els.get('authEmail').value = 'fresh@example.com';
    app.els.get('authPassword').value = 'pw123456';
    app.els.get('authSignIn').click();
    await tick(300);
    const pushed = server.getState('fresh@example.com');
    check('F1 pull 404 pushes the local profile to the empty account',
      pushed && pushed.medicines.length === 1 && pushed.medicines[0].id === 'm-local');
    check('F1 the sync label is honest after the push (Synced …)',
      app.els.get('syncBtn').textContent.includes('Synced'));
  }
  // F2: pull network-failure -> MUST NOT push (the cloud copy may be newer).
  {
    const cloudState = { ...emptyCloudState(), medicines: [cloudMed], doseLog: { '2026-11-15|m-cloud|morning': 'missed' } };
    server.addUser('cloud@example.com', 'Cloud', 'pw123456', cloudState);
    const local = makeStorage(); const session = makeStorage();
    const prof = { ...OLD_PROFILE, profileName: 'Cloud Elder', medicines: [localMed], appointments: [], circle: [], vitals: [], doseLog: {} };
    local.setItem('sahayakcare_v1', JSON.stringify(prof));
    server.failGetState = true;
    const app = runApp({ local, session, server });
    app.els.get('passInput').value = '1111';
    app.els.get('unlockBtn').click();
    await tick();
    app.els.get('authEmail').value = 'cloud@example.com';
    app.els.get('authPassword').value = 'pw123456';
    app.els.get('authSignIn').click();
    await tick(300);
    const after = server.getState('cloud@example.com');
    check('F2 pull network-failure does NOT push (cloud copy untouched)',
      after && after.medicines.length === 1 && after.medicines[0].id === 'm-cloud');
    check('F2 local data is kept (no merge happened on error)',
      app.savedState().medicines.length === 1 && app.savedState().medicines[0].id === 'm-local');
    check('F2 the label admits the sync is waiting, not "Synced"',
      app.els.get('syncBtn').textContent.includes('waiting'));
    server.failGetState = false;
  }
  // F3: pull 401 (token valid, account gone — free-tier sleep wipe) ->
  // the label is never "Synced".
  {
    const local = makeStorage(); const session = makeStorage();
    local.setItem('sahayakcare_v1', JSON.stringify(OLD_PROFILE));
    // A token for an account the server no longer knows (wiped while asleep).
    local.setItem('sahayakcare_token', server.tokenFor('ghost@example.com'));
    const app = runApp({ local, session, server });
    await tick(300); // boot token verification is async
    check('F3 a 401 at boot clears the dead token',
      local.getItem('sahayakcare_token') === null);
    check('F3 the label never claims Synced for a dead account',
      !app.els.get('syncBtn').textContent.includes('Synced'));
  }
  // F4: merge — cloud med + local med both survive; local wins a dose conflict.
  {
    const cloudState = { ...emptyCloudState(), medicines: [cloudMed], doseLog: { '2026-11-15|m-cloud|morning': 'missed', [`${today()}|m-local|evening`]: 'missed' } };
    server.addUser('merge@example.com', 'Merge', 'pw123456', cloudState);
    const local = makeStorage(); const session = makeStorage();
    const prof = { ...OLD_PROFILE, profileName: 'Merge Elder', medicines: [localMed], appointments: [], circle: [], vitals: [], doseLog: { [`${today()}|m-local|evening`]: 'taken' } };
    local.setItem('sahayakcare_v1', JSON.stringify(prof));
    const app = runApp({ local, session, server });
    app.els.get('passInput').value = '1111';
    app.els.get('unlockBtn').click();
    await tick();
    app.els.get('authEmail').value = 'merge@example.com';
    app.els.get('authPassword').value = 'pw123456';
    app.els.get('authSignIn').click();
    await tick(300);
    const st = app.savedState();
    const ids = (st.medicines || []).map(m => m.id).sort();
    check('F4 merge keeps both the cloud and the local medicine',
      ids.join(',') === 'm-cloud,m-local');
    check('F4 local wins a doseLog conflict (taken beats cloud missed)',
      st.doseLog[`${today()}|m-local|evening`] === 'taken');
    check('F4 cloud-only dose records survive the merge',
      st.doseLog['2026-11-15|m-cloud|morning'] === 'missed');
    const pushed = server.getState('merge@example.com');
    check('F4 the merged state is pushed back to the cloud',
      pushed && pushed.medicines.length === 2);
  }
  // F5: offline dose -> pending grows; backend wakes -> next save pushes.
  {
    server.addUser('off@example.com', 'Off', 'pw123456', null);
    const local = makeStorage(); const session = makeStorage();
    const prof = { ...OLD_PROFILE, profileName: 'Off Elder', medicines: [localMed], appointments: [], circle: [], vitals: [], doseLog: {} };
    local.setItem('sahayakcare_v1', JSON.stringify(prof));
    const app = runApp({ local, session, server });
    app.els.get('passInput').value = '1111';
    app.els.get('unlockBtn').click();
    await tick();
    app.els.get('authEmail').value = 'off@example.com';
    app.els.get('authPassword').value = 'pw123456';
    app.els.get('authSignIn').click();
    await tick(300);
    check('F5a sign-in pushes the local profile when the server is up',
      server.getState('off@example.com') !== null);
    server.sleeping = true;
    app.fireAppClick({ action: 'mark-dose', id: 'm-local', slot: 'evening', status: 'taken' });
    await tick(800); // debounced push (500ms) hits the sleeping backend
    check('F5b a dose marked while offline is saved locally',
      app.savedState().doseLog[`${today()}|m-local|evening`] === 'taken');
    check('F5c the pending count grows instead of claiming Synced',
      app.ev('syncState.pending') >= 1 && app.els.get('syncBtn').textContent.includes('waiting'));
    server.sleeping = false;
    app.fireAppClick({ action: 'mark-dose', id: 'm-local', slot: 'evening', status: 'missed' });
    await tick(800);
    check('F5d the next save pushes once the backend wakes (pending clears)',
      app.ev('syncState.pending') === 0 && app.els.get('syncBtn').textContent.includes('Synced'));
    check('F5e the cloud has the latest dose state',
      server.getState('off@example.com').doseLog[`${today()}|m-local|evening`] === 'missed');
  }
}

async function flowG() {
  // Share import: direct when the device is fresh, ask-first when a
  // profile exists, and a crafted link cannot inject markup or crash.
  const shared = {
    profileName: 'Shared Elder', profileAge: 70,
    medicines: [{ id: 'm-s', name: 'SharedMed', dose: '5 mg', times: ['morning'], purpose: '', stock: 3, notes: '', createdAt: '2026-11-15' }],
    appointments: [], circle: [], vitals: [], doseLog: {},
  };
  const encodeShare = obj => Buffer.from(JSON.stringify(obj)).toString('base64');
  // G1: fresh device -> import applies directly, setup screen prefilled.
  {
    const local = makeStorage(); const session = makeStorage();
    const app = runApp({ local, session, hash: '#p=' + encodeShare(shared) });
    await tick();
    const st = app.savedState();
    check('G1 fresh-device share link imports directly (no modal)',
      st && st.profileName === 'Shared Elder' && st.medicines.length === 1 && st.passcode === '');
    check('G1 setup screen is prefilled with the shared name',
      app.els.get('setupScreen').style.display === 'flex'
      && app.els.get('setupName').value === 'Shared Elder');
  }
  // G2: a profile exists -> ask first; cancel keeps it, OK replaces it.
  {
    const local = makeStorage(); const session = makeStorage();
    local.setItem('sahayakcare_v1', JSON.stringify(OLD_PROFILE));
    local.setItem('sahayakcare_token', 'x.' + Buffer.from(JSON.stringify({ sub: 'me@example.com' })).toString('base64') + '.sig');
    const app = runApp({ local, session, hash: '#p=' + encodeShare(shared) });
    await tick();
    check('G2 existing profile: the import modal asks first (no silent overwrite)',
      app.els.get('shareImportModal').style.display === 'flex');
    check('G2 old profile intact while the modal is open',
      app.savedState().profileName === 'Old Elder');
    app.els.get('shareImportCancel').click();
    await tick();
    check('G2b cancelling keeps the old profile',
      app.els.get('shareImportModal').style.display === 'none'
      && app.savedState().profileName === 'Old Elder');
    const app2 = runApp({ local, session, hash: '#p=' + encodeShare(shared) });
    await tick();
    app2.els.get('shareImportOk').click();
    await tick();
    const st = app2.savedState();
    check('G2c confirming replaces the profile with the shared one',
      st && st.profileName === 'Shared Elder' && st.medicines[0].id === 'm-s');
    check('G2d the import signs out first (token cleared)',
      local.getItem('sahayakcare_token') === null);
  }
  // G3: crafted link — markup in a name, an unknown slot, negative
  // stock, a bad email, an appointment with no date.
  {
    const evil = {
      profileName: 'Evil <script>alert(1)</script>', profileAge: 70,
      medicines: [
        { id: 'm-evil', name: '<img src=x onerror=alert(1)>', dose: '5 mg', times: ['morning', 'midnight'], purpose: '', stock: -5, notes: '', createdAt: '2026-11-15' },
        { id: '', name: '', dose: '', times: [] }, // malformed: skipped
      ],
      appointments: [{ id: 'a-evil', doctor: 'Dr. Evil' }], // no date: skipped
      circle: [{ id: 'c-evil', name: 'Evil Kin', role: 'Family', phone: '', email: 'not-an-email', status: 'approved' }],
      vitals: [{ id: 'v-evil', type: 'Weight', value: '70', date: '2026-11-14', note: '' }],
      doseLog: { 'not-a-key': 'taken', '2026-11-15|m-evil|morning': 'taken' },
    };
    const local = makeStorage(); const session = makeStorage();
    const app = runApp({ local, session, hash: '#p=' + encodeShare(evil) });
    await tick();
    const st = app.savedState();
    check('G3 crafted link imports without crashing',
      st && st.profileName.startsWith('Evil '));
    check('G3 the malformed medicine is skipped, the valid one kept',
      st.medicines.length === 1 && st.medicines[0].id === 'm-evil');
    check('G3 the unknown slot is dropped, the known one kept',
      JSON.stringify(st.medicines[0].times) === JSON.stringify(['morning']));
    check('G3 negative stock is coerced to 0, never stored negative',
      st.medicines[0].stock === 0);
    check('G3 the dateless appointment is skipped',
      st.appointments.length === 0);
    check('G3 the invalid member email is dropped, the member kept',
      st.circle.length === 1 && st.circle[0].email === '');
    check('G3 the malformed doseLog key is skipped, the valid one kept',
      st.doseLog['not-a-key'] === undefined && st.doseLog['2026-11-15|m-evil|morning'] === 'taken');
    // Finish setup, open the app, render medicines: the name must be escaped.
    app.els.get('setupPass').value = '7890';
    app.els.get('setupPassConfirm').value = '7890';
    app.els.get('setupSubmit').click();
    await tick();
    app.ev('switchTab("medicines")');
    await tick();
    const medHtml = app.els.get('medList').innerHTML;
    check('G3b the crafted name is rendered escaped, never as live markup',
      medHtml.includes('&lt;img') && !medHtml.includes('<img src=x'));
  }
}

async function flowH() {
  // Corrupted storage: the app starts fresh but SAYS so on the setup screen.
  const local = makeStorage(); const session = makeStorage();
  local.setItem('sahayakcare_v1', '{invalid json!!!');
  const app = runApp({ local, session });
  await tick();
  check('H1 corrupted storage shows the setup screen (no crash)',
    app.els.get('setupScreen').style.display === 'flex');
  check('H2 the boot notice explains the saved data was damaged',
    app.els.get('bootNotice').style.display === 'block'
    && app.els.get('bootNotice').textContent.length > 10);
  check('H3 the corrupt key is dropped, a fresh profile can be created',
    local.getItem('sahayakcare_v1') === null);
}

async function flowK() {
  // Event delegation: synthetic clicks with closest()/dataset, the way a
  // real browser bubbles them from a data-action button.
  const local = makeStorage(); const session = makeStorage();
  local.setItem('sahayakcare_v1', JSON.stringify(OLD_PROFILE));
  const app = runApp({ local, session });
  app.els.get('passInput').value = '1111';
  app.els.get('unlockBtn').click();
  await tick();
  check('K0 app opens after unlock', app.els.get('app').style.display === 'block');
  app.fireAppClick({ action: 'mark-dose', id: 'm-old', slot: 'morning', status: 'taken' });
  await tick();
  check('K1 delegation marks the dose Taken',
    app.savedState().doseLog[`${today()}|m-old|morning`] === 'taken');
  app.fireAppClick({ action: 'mark-dose', id: 'm-old', slot: 'morning', status: 'missed' });
  await tick();
  check('K1b re-marking Taken→Missed restores one unit of stock',
    app.savedState().medicines[0].stock === 19
    && app.savedState().doseLog[`${today()}|m-old|morning`] === 'missed');
  app.fireAppClick({ action: 'edit-med', id: 'm-old' });
  await tick();
  check('K2 delegation opens the edit modal with the fields filled',
    app.els.get('medModal').style.display === 'flex'
    && app.els.get('medName').value === 'Metformin');
  app.els.get('medCancel').click();
  await tick();
  app.fireAppClick({ action: 'dismiss-reminder', id: 'miss-m-old-morning' });
  await tick();
  check('K3 delegation dismisses the reminder and records the miss',
    app.savedState().doseLog[`${today()}|m-old|morning`] === 'missed');
  app.fireAppClick({ action: 'add-caretaker' });
  await tick();
  check('K4 delegation opens the add-member modal',
    app.els.get('memberModal').style.display === 'flex'
    && app.els.get('memberModalTitle').textContent.includes('Add'));
  app.els.get('memberCancel').click();
  await tick();
  app.fireAppClick({ action: 'delete-med', id: 'm-old' });
  await tick();
  check('K5 delegation delete opens the in-app confirm modal (never native)',
    app.els.get('confirmModal').style.display === 'flex' && app.confirmCalls.length === 0);
  app.els.get('confirmCancel').click();
  await tick();
  check('K5b cancelling the delete keeps the medicine',
    app.els.get('confirmModal').style.display === 'none'
    && app.savedState().medicines.length === 1);
  app.fireAppClick({ action: 'delete-med', id: 'm-old' });
  await tick();
  app.els.get('confirmOk').click();
  await tick();
  check('K5c confirming the delete removes the medicine',
    app.savedState().medicines.length === 0);
}

async function flowL() {
  // Offline-first: with the backend unreachable from the start, setup,
  // add-medicine and dose marking all work on localStorage alone.
  const server = makeServer();
  server.sleeping = true;
  const local = makeStorage(); const session = makeStorage();
  const app = runApp({ local, session, server });
  app.els.get('setupName').value = 'Offline Elder';
  app.els.get('setupPass').value = '4321';
  app.els.get('setupPassConfirm').value = '4321';
  app.els.get('setupSubmit').click();
  await tick();
  check('L1 setup works fully offline', app.els.get('app').style.display === 'block');
  app.ev('switchTab("medicines")');
  await tick();
  app.els.get('addMedBtn').click();
  await tick();
  app.els.get('medName').value = 'OfflineMed';
  app.els.get('medDose').value = '10 mg';
  app.medCheckboxes[0].checked = true; // morning
  app.els.get('medSave').click();
  await tick();
  const st = app.savedState();
  check('L2 add-medicine works offline (checkbox stub honoured)',
    st && st.medicines.length === 1 && st.medicines[0].times.join(',') === 'morning');
  // ...and a medicine with no slots is refused, even offline.
  app.els.get('addMedBtn').click();
  await tick();
  app.medCheckboxes.forEach(c => { c.checked = false; });
  app.els.get('medName').value = 'NoSlotMed';
  app.els.get('medDose').value = '5 mg';
  app.els.get('medSave').click();
  await tick();
  check('L3 a medicine with no time slots is refused at save',
    app.els.get('medError').style.display === 'block'
    && app.savedState().medicines.length === 1);
  app.els.get('medCancel').click();
  await tick();
  app.ev('switchTab("dashboard")');
  await tick();
  app.fireAppClick({ action: 'mark-dose', id: st.medicines[0].id, slot: 'morning', status: 'taken' });
  await tick(800);
  check('L4 dose marking works offline and the app never claims Synced',
    app.savedState().doseLog[`${today()}|${st.medicines[0].id}|morning`] === 'taken'
    && !app.els.get('syncBtn').textContent.includes('Synced'));
}

async function flowJ() {
  // Fetch-spy contract: login is form-urlencoded, register is JSON, and
  // the state PUT carries exactly the 5 data fields — never the passcode.
  const server = makeServer();
  const local = makeStorage(); const session = makeStorage();
  const app = runApp({ local, session, server });
  app.els.get('authName').value = 'Spy Elder';
  app.els.get('authEmail').value = 'spy@example.com';
  app.els.get('authPassword').value = 'pw123456';
  app.els.get('authSignUp').click();
  await tick(300);
  check('J5 the new account opens fresh (setup screen, empty profile)',
    app.els.get('setupScreen').style.display === 'flex');
  // Completing setup saves, and the debounced push fires the state PUT.
  app.els.get('setupName').value = 'Spy Elder';
  app.els.get('setupPass').value = '4321';
  app.els.get('setupPassConfirm').value = '4321';
  app.els.get('setupSubmit').click();
  await tick(800);
  const reg = server.calls.find(c => c.path === '/api/auth/register');
  check('J1 register sends JSON with name/email/password',
    !!reg && reg.headers['Content-Type'] === 'application/json'
    && JSON.parse(reg.body).email === 'spy@example.com'
    && JSON.parse(reg.body).password === 'pw123456');
  const login = server.calls.find(c => c.path === '/api/auth/login');
  check('J2 login sends form-urlencoded username/password',
    !!login && login.headers['Content-Type'] === 'application/x-www-form-urlencoded'
    && new URLSearchParams(login.body).get('username') === 'spy@example.com'
    && new URLSearchParams(login.body).get('password') === 'pw123456');
  const put = server.calls.find(c => c.method === 'PUT' && c.path === '/api/state');
  const putKeys = put ? Object.keys(JSON.parse(put.body)).sort() : [];
  check('J3 state PUT sends exactly the 5 data fields',
    JSON.stringify(putKeys) === JSON.stringify(['appointments', 'circle', 'doseLog', 'medicines', 'vitals']));
  check('J4 state PUT never carries the passcode',
    !!put && !put.body.includes('passcode'));
}

(async () => {
  await flowA();
  await flowB();
  await flowC();
  await flowD();
  await flowE();
  await flowF();
  await flowG();
  await flowH();
  await flowK();
  await flowL();
  await flowJ();
  console.log(failures === 0 ? '\nAll harness checks passed.' : `\n${failures} harness check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
})();
