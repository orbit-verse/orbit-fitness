/* app.js - screens, saving to Supabase, and the dashboard chart. */
'use strict';

// Shown at the bottom of the app so you can tell which version is live.
const APP_VERSION = 'v2026-11-18a';

// ====== SETTINGS: paste your values from Supabase > Project Settings > API ======
const SUPABASE_URL = 'https://fcdkvfeoxidxlwryjnaz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lPgLgvFCdGnpmYcL0vs45Q_xisgTn6l';
// Usernames are turned into a made-up internal email. If Supabase rejects ".local",
// change this to "example.com" (and create the users with that domain instead).
const EMAIL_DOMAIN = 'fit.local';
// ================================================================================

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = function (id) { return document.getElementById(id); };

const state = {
  user: null, username: '', profile: null, logs: [], targets: [],
  date: null, weekStart: null, tab: 'today', chart: null
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Chart colours, taken from the Orbit design system.
const COLORS = { accent: '#36C9DF', titanium: '#BFC9D4', muted: '#8295A6', line: '#253342',
  success: '#35C48D', warning: '#E5A94B', errorSoft: 'rgba(228,109,117,0.35)',
  period: 'rgba(201,139,185,0.18)' }; // soft mauve, kept apart from the red/amber status colours

// Allowed ranges. The database enforces the same limits, so these give friendlier messages first.
const LIMITS = {
  weight: [20, 400], calories: [0, 20000], protein: [0, 1000], steps: [0, 200000],
  age: [16, 100], height: [100, 250], window: [5, 30],
  tCalories: [1, 20000], tProtein: [1, 1000], tSteps: [0, 200000], tWorkouts: [0, 14]
};

// Monday summary: one phrase is picked to match how last week went.
const PHRASES = {
  strong: [
    'Solid week. You did what you said you would do.',
    'Targets hit across the board. Keep the same routine going.',
    'That is what consistency looks like. Same again this week.',
    'A strong week on paper and in practice. Well done.',
    'You showed up every day. The trend will follow.',
    'Nothing fancy, just the work done properly. Good week.',
    'Weeks like this are what progress is built from.',
    'You kept every promise you made to yourself last week.',
    'Good discipline all week. Carry it forward.',
    'The plan worked because you worked the plan.'
  ],
  mixed: [
    'Some wins, some gaps. Pick one gap to close this week.',
    'A decent week with room to tighten up.',
    'More went right than wrong. Build on what worked.',
    'Not perfect, and it doesn\'t need to be. Keep going.',
    'You held most of it together. Fix one thing at a time.',
    'Progress is still progress. Aim one step higher this week.',
    'The misses are useful information. Use them.',
    'A fair week. Look at the missed targets and plan around them.',
    'You are closer than the misses suggest. Stay with it.',
    'Good base to work from. Small adjustments, same effort.'
  ],
  tough: [
    'A tough week. It\'s done, and a new one starts today.',
    'One week doesn\'t undo the work before it.',
    'Start small today. One target hit is a start.',
    'Everyone has weeks like this. What matters is the next one.',
    'No need to make up for last week. Just return to the plan.',
    'The fact that you are here checking means you haven\'t quit.',
    'Reset, don\'t restart. Your earlier progress still counts.',
    'Pick the easiest target and hit it today.',
    'Last week is data, not a verdict.',
    'Back to basics this week. Log, move, eat well, sleep.'
  ]
};

// ---------- small helpers ----------
async function must(promise) { // throw if Supabase returns an error
  const r = await promise;
  if (r.error) throw r.error;
  return r.data;
}
function fmt(n, dp) {
  if (n == null || !Number.isFinite(n)) return '-';
  return n.toLocaleString('en-US', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 });
}
function fmtInt(n) { return n == null || n === '' ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function signed(n, dp) { return n == null ? '-' : (n > 0 ? '+' : '') + fmt(n, dp); }
function textOrNull(v) { v = (v || '').trim(); return v ? v : null; }

// Dates are shown as "12 Nov (Thursday)", or "12 Nov (Thu)" when short is true.
function shortDate(s) { const d = Calc.parseDate(s); return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
function dayName(s, short) { return Calc.parseDate(s).toLocaleDateString('en-GB', { weekday: short ? 'short' : 'long' }); }
function nice(s, short) { return shortDate(s) + ' (' + dayName(s, short) + ')'; }

// Read a number from an input. Blank gives null; letters or out-of-range values give a clear error.
function readNumber(id, label, limits, opts) {
  const input = $(id);
  if (input.validity && input.validity.badInput) throw new Error(label + ' must be a number.');
  const raw = String(input.value).replace(/,/g, '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(label + ' must be a number.');
  if (n < limits[0] || n > limits[1]) throw new Error(label + ' must be between ' + fmt(limits[0]) + ' and ' + fmt(limits[1]) + '.');
  if (opts && opts.whole && !Number.isInteger(n)) throw new Error(label + ' must be a whole number.');
  return opts && opts.dp != null ? Number(n.toFixed(opts.dp)) : n;
}
function readScale(id) { const v = $(id).value; return v === '' ? null : Number(v); }

// Whole-number boxes (steps, calories, protein...): letters are ignored and commas are added as you type.
function wireInt(input) {
  input.addEventListener('input', function () {
    const pos = input.selectionStart == null ? input.value.length : input.selectionStart;
    const digitsBeforeCaret = input.value.slice(0, pos).replace(/\D/g, '').length;
    const digits = input.value.replace(/\D/g, '');
    const out = digits ? Number(digits).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';
    input.value = out;
    let p = 0, seen = 0;
    while (p < out.length && seen < digitsBeforeCaret) { if (/\d/.test(out[p])) seen++; p++; }
    try { input.setSelectionRange(p, p); } catch (e) { /* some browsers refuse; harmless */ }
  });
}

function say(id, text, kind) { const el = $(id); el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); }
function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function levelClass(level) { return level && level !== 'none' ? ' t-' + level : ''; }

// One small number block: label on top, value, optional line underneath. Levels add the status colour.
function metric(label, value, sub, valueLevel, subLevel, wide) {
  const m = el('div', null, 'metric' + (wide ? ' wide' : ''));
  m.appendChild(el('span', label, 'label'));
  m.appendChild(el('span', value, 'v' + levelClass(valueLevel)));
  if (sub) m.appendChild(el('span', sub, 'sub' + levelClass(subLevel)));
  return m;
}
// One row of "name ........ value" (Monday summary and suggested targets).
function line(name, value, level) {
  const r = el('div', null, 'line');
  r.appendChild(el('span', name, 'k'));
  r.appendChild(el('span', value, 'val' + levelClass(level)));
  return r;
}
function checkIcon() { // green tick for the Workout column (fixed markup, no user data)
  const s = el('span');
  s.innerHTML = '<svg role="img" aria-label="Yes" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#35C48D" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
  return s.firstChild;
}

// The rate-of-change block: big percent, kg per week underneath, then the status for the user's goal.
// point = a row from the trend series (or null when there is not enough data yet).
function fillRoc(box, title, point, small) {
  box.innerHTML = '';
  const goal = state.profile.goal;
  const pct = point && point.weeklyChangePct != null ? point.weeklyChangePct * 100 : null;
  const status = Calc.rocStatus(goal, pct);
  const wrap = el('div', null, 'roc' + (small ? ' small' : ''));
  wrap.appendChild(el('span', title, 'label'));
  const big = el('div', null, 'big');
  if (pct == null) {
    big.appendChild(el('span', 'Not enough data', 'v'));
    wrap.appendChild(big);
    wrap.appendChild(el('span', 'Needs weigh-ins across at least 8 days', 'kg'));
  } else {
    big.appendChild(el('span', signed(pct, 2) + '%', 'v'));
    big.appendChild(el('span', 'per week', 'u'));
    wrap.appendChild(big);
    wrap.appendChild(el('span', signed(point.weeklyChange, 2) + ' kg per week', 'kg'));
  }
  const st = el('div', null, 'status');
  if (pct != null) st.appendChild(el('span', status.label, 'chip-status' + levelClass(status.level)));
  st.appendChild(el('span', status.range, 'label'));
  wrap.appendChild(st);
  box.appendChild(wrap);
  return { pct: pct, status: status };
}

// Period tracking is only shown when the profile sex is female.
function isFemale() { return !!state.profile && state.profile.sex === 'female'; }

function series() { return state.profile ? Calc.buildSeries(state.logs, state.profile.trend_window_days) : []; }
function todayStr() { return Calc.toDateStr(new Date()); }
function greet() {
  const name = state.profile && state.profile.first_name ? state.profile.first_name : state.username;
  $('who').textContent = name ? 'Hi, ' + name : '';
}

// ---------- screens ----------
function showScreen(name) { // 'login' or 'app'
  $('login').classList.toggle('hidden', name !== 'login');
  $('app').classList.toggle('hidden', name !== 'app');
  $('topbar').classList.toggle('hidden', name !== 'app');
  $('tabs').classList.toggle('hidden', name !== 'app');
}

function showTab(name) {
  if (!state.profile && name !== 'profile') name = 'profile'; // must finish profile first
  state.tab = name;
  ['today', 'week', 'dashboard', 'profile'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== name); });
  document.querySelectorAll('#tabs button').forEach(function (b) {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    b.disabled = !state.profile && b.dataset.tab !== 'profile';
  });
  window.scrollTo(0, 0);
  if (name === 'today') renderToday();
  if (name === 'week') renderWeek();
  if (name === 'dashboard') renderDashboard();
  if (name === 'profile') renderProfile();
}

// ---------- login / logout ----------
async function doLogin() {
  const username = $('username').value.trim().toLowerCase();
  const password = $('password').value;
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) { say('loginMsg', 'Enter your username.', 'err'); return; }
  say('loginMsg', 'Logging in...');
  const r = await db.auth.signInWithPassword({ email: username + '@' + EMAIL_DOMAIN, password: password });
  if (r.error) say('loginMsg', 'Login failed. Check your username and password.', 'err');
  else $('password').value = '';
}

async function onSession(session) {
  // Token refreshes fire this again for the same user; ignore those so the screen doesn't reset.
  if (session && state.user && session.user.id === state.user.id) return;
  if (!session) {
    state.user = null; state.username = ''; state.profile = null; state.logs = []; state.targets = [];
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    showScreen('login'); say('loginMsg', '');
    return;
  }
  state.user = session.user;
  state.username = session.user.email.split('@')[0];
  greet();
  showScreen('app');
  try {
    const results = await Promise.all([
      must(db.from('profiles').select('*').maybeSingle()),
      must(db.from('daily_logs').select('*').order('date', { ascending: true }).limit(5000)),
      must(db.from('weekly_targets').select('*').order('week_start', { ascending: true }))
    ]);
    state.profile = results[0]; state.logs = results[1]; state.targets = results[2];
  } catch (e) {
    showTab('profile'); say('profileMsg', 'Could not load your data: ' + e.message, 'err'); return;
  }
  greet();
  state.date = todayStr();
  state.weekStart = Calc.weekStart(state.date);
  showTab(state.profile ? 'today' : 'profile');
}

// ---------- PROFILE ----------
function fillProfileLists() {
  const a = $('p-activity'); a.innerHTML = '';
  a.appendChild(new Option('Select', ''));
  Calc.ACTIVITY_LEVELS.forEach(function (x) { a.appendChild(new Option(x.label, x.key)); });
  const l = $('p-lifting'); l.innerHTML = '';
  l.appendChild(new Option('Select', ''));
  for (let i = 0; i <= 7; i++) l.appendChild(new Option(String(i), String(i)));
}

function renderProfile() {
  const p = state.profile;
  $('profileIntro').classList.toggle('hidden', !!p);
  if (p) {
    const v = function (x) { return x == null ? '' : x; };
    $('p-name').value = p.first_name; $('p-sex').value = p.sex; $('p-age').value = p.age;
    $('p-height').value = p.height_cm; $('p-goal').value = p.goal; $('p-window').value = p.trend_window_days;
    $('p-activity').value = v(p.activity_level); $('p-lifting').value = v(p.lifting_sessions);
    // No starting weight saved yet? Offer the first weight ever logged as a starting point.
    const first = state.logs.filter(function (l) { return l.weight_kg != null; })[0];
    $('p-start').value = p.starting_weight_kg != null ? p.starting_weight_kg : (first ? first.weight_kg : '');
  }
  say('profileMsg', p && (p.starting_weight_kg == null || !p.activity_level || p.lifting_sessions == null)
    ? 'New: add your starting weight, lifting sessions and activity level, then save to see suggested targets.' : '');
  renderSuggestion();
}

// Suggested targets from the saved profile (starting weight, activity level, lifting sessions).
function profileSuggestion() {
  const p = state.profile;
  if (!p || p.starting_weight_kg == null || !p.activity_level || p.lifting_sessions == null) return null;
  const steps = Calc.activitySteps(p.activity_level);
  if (steps == null) return null;
  const r = Calc.suggestTargets({ sex: p.sex, age: p.age, heightCm: Number(p.height_cm), weightKg: Number(p.starting_weight_kg),
    goal: p.goal, steps: steps, workouts: Number(p.lifting_sessions) });
  r.steps = steps; r.workouts = Number(p.lifting_sessions);
  return r;
}

function renderSuggestion() {
  const r = profileSuggestion();
  $('suggestCard').classList.toggle('hidden', !r);
  say('suggestMsg', '');
  if (!r) return;
  const goalName = { cut: 'Cut', bulk: 'Bulk', maintain: 'Maintenance' }[state.profile.goal];
  const box = $('suggestLines'); box.innerHTML = '';
  box.appendChild(line('Maintenance', fmt(r.tdee) + ' kcal'));
  box.appendChild(line(goalName + ' calorie range', r.caloriesLow === r.caloriesHigh ? fmt(r.caloriesLow) + ' kcal' : fmt(r.caloriesLow) + ' to ' + fmt(r.caloriesHigh) + ' kcal'));
  box.appendChild(line('Protein range', r.proteinMin + ' to ' + r.proteinMax + ' g'));
  box.appendChild(line('Daily steps', fmt(r.steps)));
  box.appendChild(line('Workouts per week', String(r.workouts)));
}

async function saveProfile() {
  let row;
  try {
    row = {
      user_id: state.user.id,
      first_name: $('p-name').value.trim(), sex: $('p-sex').value,
      age: readNumber('p-age', 'Age', LIMITS.age, { whole: true }),
      height_cm: readNumber('p-height', 'Height', LIMITS.height, { dp: 1 }),
      starting_weight_kg: readNumber('p-start', 'Starting weight', LIMITS.weight, { dp: 1 }),
      goal: $('p-goal').value,
      activity_level: $('p-activity').value || null,
      lifting_sessions: $('p-lifting').value === '' ? null : Number($('p-lifting').value),
      trend_window_days: readNumber('p-window', 'Trend smoothing', LIMITS.window, { whole: true }) || 10
    };
  } catch (e) { say('profileMsg', e.message, 'err'); return; }
  if (!row.first_name || !row.sex || !row.age || !row.height_cm || row.starting_weight_kg == null ||
      !row.activity_level || row.lifting_sessions == null) {
    say('profileMsg', 'Please fill in every field.', 'err'); return;
  }
  try {
    const wasNew = !state.profile;
    state.profile = await must(db.from('profiles').upsert(row, { onConflict: 'user_id' }).select().single());
    greet();
    if (wasNew) showTab('profile'); // unlocks the other tabs
    else { $('profileIntro').classList.add('hidden'); renderSuggestion(); }
    say('profileMsg', 'Saved. Your suggested targets are below.', 'ok');
  } catch (e) { say('profileMsg', 'Could not save: ' + e.message, 'err'); }
}

// "Use these as my targets": saves the suggestion as this week's targets.
async function useSuggested() {
  const r = profileSuggestion();
  if (!r) return;
  const wk = Calc.weekStart(todayStr());
  const row = { user_id: state.user.id, week_start: wk, calories: r.calories, protein_g: r.protein, steps: r.steps, workouts: r.workouts };
  try {
    const saved = await must(db.from('weekly_targets').upsert(row, { onConflict: 'user_id,week_start' }).select().single());
    state.targets = state.targets.filter(function (x) { return x.week_start !== saved.week_start; }).concat(saved)
      .sort(function (a, b) { return a.week_start < b.week_start ? -1 : 1; });
    say('suggestMsg', 'Saved as this week\'s targets: ' + fmt(r.calories) + ' kcal, ' + r.protein + ' g protein, ' +
      fmt(r.steps) + ' steps, ' + r.workouts + ' workouts. You can adjust them on the Week tab.', 'ok');
  } catch (e) { say('suggestMsg', 'Could not save: ' + e.message, 'err'); }
}

// ---------- TODAY ----------
function fillScale(selectId) {
  const s = $(selectId); s.innerHTML = '';
  s.appendChild(new Option('-', ''));
  for (let i = 1; i <= 5; i++) s.appendChild(new Option(String(i), String(i)));
}

function renderToday() {
  const today = todayStr();
  $('logDate').max = today; // no logging for days that haven't happened yet
  if (state.date > today) state.date = today;
  $('logDate').value = state.date;
  $('dayName').textContent = dayName(state.date) + (state.date === today ? ' · Today' : '');
  $('dayNext').disabled = state.date >= today;
  const l = state.logs.find(function (x) { return x.date === state.date; }) || {};
  const v = function (x) { return x == null ? '' : x; };
  $('f-weight').value = v(l.weight_kg); $('f-steps').value = fmtInt(l.steps);
  $('f-calories').value = fmtInt(l.calories); $('f-protein').value = fmtInt(l.protein_g);
  $('f-workout').checked = !!l.did_workout;
  $('periodRow').classList.toggle('hidden', !isFemale());
  $('f-period').checked = isFemale() && !!l.menstruating;
  $('f-activities').value = v(l.activities);
  $('f-sleep').value = v(l.sleep_quality); $('f-stress').value = v(l.stress_level);
  $('f-fatigue').value = v(l.fatigue_level); $('f-hunger').value = v(l.hunger_level);
  $('f-wins').value = v(l.wins); $('f-tomorrow').value = v(l.tomorrow_plan);
  say('todayMsg', l.date ? 'Editing the entry saved for this day.' : '');
}

async function saveDay() {
  let row;
  try {
    row = {
      user_id: state.user.id, date: state.date,
      weight_kg: readNumber('f-weight', 'Weight', LIMITS.weight, { dp: 2 }),
      steps: readNumber('f-steps', 'Steps', LIMITS.steps, { whole: true }),
      calories: readNumber('f-calories', 'Calories', LIMITS.calories, { whole: true }),
      protein_g: readNumber('f-protein', 'Protein', LIMITS.protein, { whole: true }),
      did_workout: $('f-workout').checked,
      menstruating: isFemale() && $('f-period').checked,
      activities: textOrNull($('f-activities').value),
      sleep_quality: readScale('f-sleep'), stress_level: readScale('f-stress'),
      fatigue_level: readScale('f-fatigue'), hunger_level: readScale('f-hunger'),
      wins: textOrNull($('f-wins').value), tomorrow_plan: textOrNull($('f-tomorrow').value)
    };
  } catch (e) { say('todayMsg', e.message, 'err'); return; }
  try {
    const saved = await must(db.from('daily_logs').upsert(row, { onConflict: 'user_id,date' }).select().single());
    state.logs = state.logs.filter(function (x) { return x.date !== saved.date; }).concat(saved)
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    say('todayMsg', 'Saved for ' + nice(state.date) + '.', 'ok');
  } catch (e) { say('todayMsg', 'Could not save: ' + e.message, 'err'); }
}

function moveDay(n) {
  const next = Calc.addDays(state.date, n);
  if (next > todayStr()) return;
  state.date = next; renderToday();
}

// ---------- WEEK ----------
function renderWeek() {
  const wk = state.weekStart;
  const goal = state.profile.goal;
  $('weekLabel').textContent = nice(wk, true) + ' to ' + nice(Calc.addDays(wk, 6), true);
  const own = state.targets.find(function (t) { return t.week_start === wk; });
  const t = own || Calc.targetsFor(wk, state.targets) || {};
  const has = !!t.week_start;
  const v = function (x) { return x == null ? '' : x; };
  $('t-calories').value = fmtInt(t.calories); $('t-protein').value = fmtInt(t.protein_g);
  $('t-steps').value = fmtInt(t.steps); $('t-workouts').value = v(t.workouts);
  say('targetMsg', own ? '' : (has ? 'No targets set for this week yet. Showing the ones from the week of ' + nice(t.week_start) + '. Save to confirm them.'
    : 'No targets yet. Fill them in, or use the suggested targets on the Profile tab.'));

  const sum = Calc.summarizeWeek(state.logs, wk, has ? t : null);
  const ev = Calc.evaluateWeek(sum, has ? t : null, goal, todayStr());

  // Rate of change for this week
  fillRoc($('weekRoc'), 'Rate of change', Calc.weekRoc(series(), wk), true);

  // Targets: how the week is going (or went)
  const tiles = $('weekTiles'); tiles.innerHTML = '';
  const withLabel = function (rule, text) { return rule.label ? rule.label + ' · ' + text : text; };
  if (ev.calories.mode === 'daily') {
    tiles.appendChild(metric('Calorie days hit', t.calories ? ev.calories.hits + ' / 7' : '-', t.calories ? 'target ' + fmt(t.calories) + ' daily' : 'no target set', ev.calories.level));
  } else {
    tiles.appendChild(metric('Avg calories', fmt(sum.avgCalories), t.calories ? withLabel(ev.calories, 'target ' + fmt(t.calories)) : 'no target set', null, ev.calories.level));
  }
  tiles.appendChild(metric('Protein days hit', t.protein_g ? ev.protein.hits + ' / 7' : '-', t.protein_g ? 'target ' + t.protein_g + ' g daily' : 'no target set', ev.protein.level));
  tiles.appendChild(metric('Avg steps', fmt(sum.avgSteps), t.steps ? withLabel(ev.steps, 'target ' + fmt(t.steps)) : 'no target set', null, ev.steps.level));
  tiles.appendChild(metric('Workouts', String(sum.workouts), t.workouts != null ? withLabel(ev.workouts, 'target ' + t.workouts) : 'no target set', null, ev.workouts.level));

  // Sleep, stress, fatigue and hunger: one box each, tinted by how the weekly average looks
  const boxes = $('weekBoxes'); boxes.innerHTML = '';
  [['Sleep', 'sleep', sum.avgSleep], ['Stress', 'stress', sum.avgStress], ['Fatigue', 'fatigue', sum.avgFatigue], ['Hunger', 'hunger', sum.avgHunger]]
    .forEach(function (x) {
      const w = Calc.wellbeingLevel(x[1], x[2]);
      const b = el('div', null, 'box' + (w.level !== 'none' ? ' b-' + w.level : ''));
      b.appendChild(el('span', x[0], 'n'));
      b.appendChild(el('span', x[2] == null ? '-' : fmt(x[2], 1), 'v'));
      b.appendChild(el('span', w.label, 's'));
      boxes.appendChild(b);
    });

  $('periodKey').classList.toggle('hidden', !isFemale());
  const body = $('weekRows'); body.innerHTML = '';
  sum.days.forEach(function (d) {
    const l = d.log || {};
    const tr = document.createElement('tr');
    [nice(d.date, true), l.weight_kg != null ? fmt(Number(l.weight_kg), 1) : '-', fmt(l.calories), fmt(l.protein_g), fmt(l.steps)]
      .forEach(function (c) { tr.appendChild(el('td', c)); });
    if (isFemale() && l.menstruating) { // small mauve dot next to the date on period days
      const dot = el('span', null, 'pdot');
      dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', 'Period day'); dot.title = 'Period day';
      tr.firstChild.appendChild(dot);
    }
    const w = el('td');
    if (l.did_workout) w.appendChild(checkIcon()); // green tick if done, blank if not
    tr.appendChild(w);
    body.appendChild(tr);
  });
}

function moveWeek(n) { state.weekStart = Calc.addDays(state.weekStart, 7 * n); renderWeek(); }

async function saveTargets() {
  let row;
  try {
    row = {
      user_id: state.user.id, week_start: state.weekStart,
      calories: readNumber('t-calories', 'Calories target', LIMITS.tCalories, { whole: true }),
      protein_g: readNumber('t-protein', 'Protein target', LIMITS.tProtein, { whole: true }),
      steps: readNumber('t-steps', 'Steps target', LIMITS.tSteps, { whole: true }),
      workouts: readNumber('t-workouts', 'Workouts target', LIMITS.tWorkouts, { whole: true })
    };
  } catch (e) { say('targetMsg', e.message, 'err'); return; }
  try {
    const saved = await must(db.from('weekly_targets').upsert(row, { onConflict: 'user_id,week_start' }).select().single());
    state.targets = state.targets.filter(function (x) { return x.week_start !== saved.week_start; }).concat(saved)
      .sort(function (a, b) { return a.week_start < b.week_start ? -1 : 1; });
    renderWeek(); say('targetMsg', 'Targets saved.', 'ok');
  } catch (e) { say('targetMsg', 'Could not save: ' + e.message, 'err'); }
}

// ---------- DASHBOARD ----------
// The summary of last week appears on the first day you open the dashboard in a new week,
// and is gone the next day. The "first day" is remembered on this device only.
function summaryDue() {
  const wk = Calc.weekStart(todayStr());
  const key = 'orbit.summary.' + state.user.id;
  let s = null;
  try { s = JSON.parse(localStorage.getItem(key)); } catch (e) { s = null; }
  if (!s || s.week !== wk) {
    s = { week: wk, shownOn: todayStr() };
    try { localStorage.setItem(key, JSON.stringify(s)); } catch (e) { /* private mode: still show it today */ }
  }
  return s.shownOn === todayStr();
}

function renderSummary(s) {
  const card = $('summaryCard');
  card.classList.add('hidden'); card.innerHTML = '';
  const today = todayStr();
  const prev = Calc.addDays(Calc.weekStart(today), -7);
  const t = Calc.targetsFor(prev, state.targets);
  const sum = Calc.summarizeWeek(state.logs, prev, t);
  if (sum.days.every(function (d) { return !d.log; })) return; // nothing logged last week
  if (!summaryDue()) return;

  const goal = state.profile.goal;
  const ev = Calc.evaluateWeek(sum, t, goal, today);
  const point = Calc.weekRoc(s, prev);
  const pct = point ? point.weeklyChangePct * 100 : null;
  const roc = Calc.rocStatus(goal, pct);
  const none = function (rule) { return rule.level === 'none'; };

  const head = el('div', null, 'cardhead');
  head.appendChild(el('h2', 'Last week'));
  head.appendChild(el('span', shortDate(prev) + ' to ' + shortDate(Calc.addDays(prev, 6)), 'label'));
  card.appendChild(head);

  const lines = el('div', null, 'lines');
  if (ev.calories.mode === 'daily') lines.appendChild(line('Calories (daily)', none(ev.calories) ? 'No data' : ev.calories.hits + ' / 7 days', ev.calories.level));
  else lines.appendChild(line('Calories (weekly average)', none(ev.calories) ? 'No data' : ev.calories.label + ' · ' + fmt(sum.avgCalories), ev.calories.level));
  lines.appendChild(line('Protein (daily)', none(ev.protein) ? 'No data' : ev.protein.hits + ' / 7 days', ev.protein.level));
  lines.appendChild(line('Steps (weekly average)', none(ev.steps) ? 'No data' : ev.steps.label + ' · ' + fmt(sum.avgSteps), ev.steps.level));
  lines.appendChild(line('Workouts', none(ev.workouts) ? 'No target set' : ev.workouts.label + ' · ' + sum.workouts + ' of ' + t.workouts, ev.workouts.level));
  lines.appendChild(line('Rate of change', pct == null ? 'Not enough data' : roc.label + ' · ' + signed(pct, 2) + '%', roc.level));
  card.appendChild(lines);

  const kind = Calc.weekKind([ev.calories.level, ev.protein.level, ev.steps.level, ev.workouts.level, roc.level]);
  if (kind) {
    const list = PHRASES[kind];
    const n = Math.abs(Math.round(Calc.daysBetween('2026-01-05', prev) / 7)) % list.length; // a different phrase each week
    card.appendChild(el('p', list[n], 'phrase'));
  }
  card.classList.remove('hidden');
}

function renderDashboard() {
  const s = series();
  const tiles = $('dashTiles'); tiles.innerHTML = '';
  $('summaryCard').classList.add('hidden');
  if (!s.length) {
    const box = $('dashRoc'); box.innerHTML = '';
    box.appendChild(el('span', 'No data yet', 'label'));
    box.appendChild(el('span', 'Log a weight on the Today tab to start your trend.', 'sub'));
    tiles.classList.add('hidden'); $('chartCard').classList.add('hidden');
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    return;
  }
  tiles.classList.remove('hidden'); $('chartCard').classList.remove('hidden');
  $('periodChip').classList.toggle('hidden', !isFemale());
  renderSummary(s);

  const last = s[s.length - 1];
  const back = function (n) { return s.length > n ? s[s.length - 1 - n].trend : null; };
  const d14 = back(14) != null ? last.trend - back(14) : null;
  const recent = s.slice(-7);
  const avgOf = function (f) { const a = recent.map(function (p) { return p[f]; }).filter(function (x) { return x != null; }); return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };

  // Rate of change is the main number; the weights sit underneath in smaller text.
  const hero = $('dashRoc');
  fillRoc(hero, 'Rate of change (7 days)', last, false);
  const split = el('div', null, 'split');
  const a = el('div', null, 'metric'); a.appendChild(el('span', 'Trend weight', 'label')); a.appendChild(el('span', fmt(last.trend, 2) + ' kg', 'v'));
  const b = el('div', null, 'metric right'); b.appendChild(el('span', 'Latest weigh-in', 'label'));
  b.appendChild(el('span', s.filter(function (p) { return p.weight != null; }).pop().weight + ' kg', 'sub'));
  split.appendChild(a); split.appendChild(b);
  hero.appendChild(split);

  tiles.appendChild(metric('Change (14 days)', d14 == null ? 'Not enough data' : signed(d14, 2) + ' kg', d14 == null ? '' : 'based on trend weight'));
  tiles.appendChild(metric('Total change', signed(last.trend - s[0].trend, 2) + ' kg', 'since ' + shortDate(s[0].date)));
  tiles.appendChild(metric('Avg calories (7 days)', fmt(avgOf('calories'))));
  tiles.appendChild(metric('Avg steps (7 days)', fmt(avgOf('steps'))));
  tiles.appendChild(metric('Est. maintenance', last.tdee == null ? 'Not enough data' : fmt(last.tdee) + ' kcal',
    last.tdee == null ? 'needs about 5 weigh-ins and 5 calorie days in 10 days' : 'from intake and weight trend', null, null, true));
  drawChart(s);
}

function drawChart(s) {
  if (Chart.defaults) {
    Chart.defaults.color = COLORS.muted;
    Chart.defaults.borderColor = COLORS.line;
    Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  }
  const range = Number($('range').value);
  const pts = range ? s.slice(-range) : s;
  const on = function (k) { return $('ov-' + k).checked && (k !== 'period' || isFemale()); };
  // Cyan = main series (trend), titanium = secondary (actual weigh-ins).
  const datasets = [
    { label: 'Weight (actual)', data: pts.map(function (p) { return p.weight; }), showLine: false, pointRadius: 3, borderColor: COLORS.titanium, backgroundColor: COLORS.titanium, yAxisID: 'y' },
    { label: 'Trend weight', data: pts.map(function (p) { return p.trend; }), borderColor: COLORS.accent, backgroundColor: COLORS.accent, borderWidth: 3, pointRadius: 0, tension: 0.2, yAxisID: 'y' }
  ];
  const overlay = function (label, key, color, axis, dash) {
    return { label: label, data: pts.map(function (p) { return p[key]; }), borderColor: color, backgroundColor: color, borderWidth: 1.5, borderDash: dash, pointRadius: 1.5, spanGaps: true, yAxisID: axis };
  };
  if (on('calories')) datasets.push(overlay('Calories', 'calories', COLORS.warning, 'yCal', [4, 3]));
  if (on('protein')) datasets.push(overlay('Protein (g)', 'protein', COLORS.success, 'yPro', [2, 3]));
  if (on('steps')) datasets.push(overlay('Steps', 'steps', COLORS.muted, 'ySteps', [8, 4]));
  // Workouts: short cyan markers along the bottom of the chart.
  if (on('workouts')) datasets.push({ type: 'bar', label: 'Workout', data: pts.map(function (p) { return p.did_workout ? 1 : null; }),
    backgroundColor: COLORS.accent, borderRadius: 3, barPercentage: 0.5, grouped: false, yAxisID: 'yWork', order: 5 });
  // Period: full-height light bands behind everything; back-to-back days join into one block.
  if (on('period')) datasets.push({ type: 'bar', label: 'Period', data: pts.map(function (p) { return p.menstruating ? 1 : null; }),
    backgroundColor: COLORS.period, barPercentage: 1, categoryPercentage: 1, grouped: false, yAxisID: 'yPeriod', order: 10 });

  const hidden = function (extra) { return Object.assign({ display: false, position: 'right', grid: { drawOnChartArea: false } }, extra || {}); };
  if (state.chart) state.chart.destroy();
  state.chart = new Chart($('chart'), {
    type: 'line',
    data: { labels: pts.map(function (p) { return p.date; }), datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { boxWidth: 12, boxHeight: 12 } },
        tooltip: { callbacks: {
          title: function (items) { const d = items[0].label; return d + ' (' + dayName(d) + ')'; },
          label: function (c) { // yes/no overlays read as words rather than "1"
            if (c.dataset.label === 'Workout') return 'Workout done';
            if (c.dataset.label === 'Period') return 'Period day';
            return c.dataset.label + ': ' + c.formattedValue;
          } } }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 6, callback: function (value) { return shortDate(this.getLabelForValue(value)); } } },
        y: { title: { display: true, text: 'kg' } },
        yCal: hidden(), yPro: hidden(), ySteps: hidden(), yWork: hidden({ min: 0, max: 10 }), yPeriod: hidden({ min: 0, max: 1 })
      }
    }
  });
  say('dashMsg', datasets.length > 2 ? 'Calories, protein, steps, workouts and period days are drawn on their own hidden scales; tap a point to see the real values.' : '');
}

// ---------- start ----------
function wire() {
  $('version').textContent = APP_VERSION;
  ['f-sleep', 'f-stress', 'f-fatigue', 'f-hunger'].forEach(fillScale);
  fillProfileLists();
  document.querySelectorAll('input.int').forEach(wireInt);
  $('loginBtn').onclick = doLogin;
  $('password').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  $('logoutBtn').onclick = function () { db.auth.signOut(); };
  document.querySelectorAll('#tabs button').forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab); }; });
  $('saveProfile').onclick = saveProfile;
  $('useSuggested').onclick = useSuggested;
  $('saveDay').onclick = saveDay;
  $('dayPrev').onclick = function () { moveDay(-1); };
  $('dayNext').onclick = function () { moveDay(1); };
  $('logDate').onchange = function () {
    const v = $('logDate').value;
    if (v) { state.date = v > todayStr() ? todayStr() : v; renderToday(); }
  };
  $('weekPrev').onclick = function () { moveWeek(-1); };
  $('weekNext').onclick = function () { moveWeek(1); };
  $('saveTargets').onclick = saveTargets;
  $('range').onchange = renderDashboard;
  ['calories', 'protein', 'steps', 'workouts', 'period'].forEach(function (k) { $('ov-' + k).onchange = renderDashboard; });

  // Note: do not call other Supabase functions directly inside this callback; defer with setTimeout.
  db.auth.onAuthStateChange(function (_event, session) { setTimeout(function () { onSession(session); }, 0); });
}
wire();
