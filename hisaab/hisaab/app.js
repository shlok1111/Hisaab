/* =====================================================================
   HISAAB  -  a spending tracker that runs entirely in the browser.

   How to read this file. It is one script in nine numbered parts:
     1. CONFIG      the lists the app is built around (categories, payment modes)
     2. HELPERS     small tools for dates, money and text
     3. LOGIC       pure calculations: totals, budgets, balances, recurring, streak
     4. STORE       saving and loading (the browser's localStorage)
     5. SCREENS     each screen is a function that turns data into HTML
     6. SHEETS      the pop-up forms
     7. EXPORT      backup, spreadsheet export, restore
     8. WIRING      one click listener that connects buttons to actions
     9. APP SHELL   offline support, install button, storage protection

   The one idea to hold on to:   entries -> saved -> every screen redrawn.
   Totals are never stored. They are worked out from the entries each time.
   ===================================================================== */
"use strict";

/* =====================================================================
   1. CONFIG  -  the lists the app is built around. Safe to edit.
   "words" are the keywords the one-line entry uses to guess a category.
   ===================================================================== */
const EXPENSE_CATS = [
  { id: "food",      name: "Food & dining",         icon: "🍽️", words: ["swiggy","zomato","chai","tea","coffee","lunch","dinner","breakfast","snack","snacks","maggi","canteen","mess","restaurant","cafe","pizza","burger","dosa","juice","food","dominos","starbucks","momos","thali","paratha","icecream","dessert","bakery","samosa","sandwich"] },
  { id: "groceries", name: "Groceries",             icon: "🛒", words: ["grocery","groceries","blinkit","zepto","instamart","bigbasket","dmart","milk","vegetables","fruits","kirana","supermarket"] },
  { id: "transport", name: "Transport",             icon: "🛺", words: ["uber","ola","rapido","auto","cab","taxi","bus","train","metro","petrol","fuel","flight","irctc","rickshaw","toll","parking"] },
  { id: "shopping",  name: "Shopping",              icon: "🛍️", words: ["amazon","flipkart","myntra","ajio","meesho","clothes","shoes","shirt","jeans","tshirt","watch","headphones"] },
  { id: "fun",       name: "Fun & outings",         icon: "🎉", words: ["movie","pvr","inox","party","club","bowling","trip","outing","concert","game","games","arcade","bookmyshow"] },
  { id: "bills",     name: "Bills & subscriptions", icon: "🧾", words: ["recharge","jio","airtel","wifi","electricity","rent","bill","claude","subscription","spotify","netflix","prime","hotstar","youtube"] },
  { id: "health",    name: "Health & fitness",      icon: "💊", words: ["medicine","pharmacy","doctor","gym","protein","medical","hospital","chemist","supplement","whey","creatine"] },
  { id: "education", name: "Education",             icon: "📚", words: ["book","books","course","stationery","print","printout","xerox","fees","exam","notebook","pen","udemy","coursera"] },
  { id: "care",      name: "Personal care",         icon: "✂️", words: ["haircut","salon","barber","shampoo","facewash","grooming","laundry","soap","trimmer"] },
  { id: "other",     name: "Other",                 icon: "📦", words: [] },
];
const MODES = [{ id: "upi", name: "UPI" }, { id: "cash", name: "Cash" }, { id: "card", name: "Card" }];
const REPEATS = [{ every: 1, name: "Every month" }, { every: 3, name: "Every 3 months" }, { every: 6, name: "Every 6 months" }, { every: 12, name: "Every year" }];
const TABS = ["overview", "history", "budget", "people", "setup"];
/* Settings are everything that is not an entry: budgets, your own categories,
   recurring payments, days you marked "no spend", and the date of your last backup. */
const DEFAULT_SETTINGS = { weekStart: 1, defaultMode: "upi", budgets: { total: 0, cats: {} }, theme: "auto", customCats: [], recurring: [], quietDays: [], lastBackup: "", updatedAt: "" };
const LOCAL_KEY = "hisaab.v1";      // the name of the one storage slot that holds everything

/* =====================================================================
   2. HELPERS  -  small tools for dates, money and text.
   Dates are stored as plain text "2026-11-16" (local day). Text dates
   sort correctly and never shift with time zones.
   ===================================================================== */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const pad = n => String(n).padStart(2, "0");
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const keyToDate = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const todayKey = () => dateKey(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = text => { const n = parseFloat(String(text).replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? round2(n) : 0; };
const inr = n => { const v = round2(n), whole = Number.isInteger(v);
  return (v < 0 ? "−" : "") + "₹" + new Intl.NumberFormat("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(Math.abs(v)); };
const short1 = x => String(Math.round(x * 10) / 10);
const inrShort = n => n >= 100000 ? `₹${short1(n / 100000)}L` : n >= 1000 ? `₹${short1(n / 1000)}k` : inr(Math.round(n));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (d, opts) => new Intl.DateTimeFormat("en-IN", opts).format(d);
const dayLabel = key => fmt(keyToDate(key), { weekday: "short", day: "numeric", month: "short" });
const nameKey = s => String(s).trim().toLowerCase().replace(/\s+/g, " ");
const tidyName = s => String(s).trim().replace(/\s+/g, " ").replace(/(^|\s)\S/g, c => c.toUpperCase());
const entries = n => n === 1 ? "1 entry" : `${n} entries`;
const daysBetween = (fromKey, toKey) => Math.round((keyToDate(toKey) - keyToDate(fromKey)) / 86400000);

const expenseCats = s => [...EXPENSE_CATS.filter(c => c.id !== "other"), ...(s.customCats || []), EXPENSE_CATS[EXPENSE_CATS.length - 1]];
const catOf = (id, s) => expenseCats(s).find(c => c.id === id) || EXPENSE_CATS[EXPENSE_CATS.length - 1];
const modeName = id => (MODES.find(m => m.id === id) || {}).name || "";

/* =====================================================================
   3. LOGIC  -  pure functions: data in, answer out. No screen, no storage.
   This is the part to read first if you want to explain the app.
   ===================================================================== */

/* One entry in the ledger. Every record always carries every field
   (null when unused) so an edit fully overwrites the old version.
   kind:  "expense" | "gave" | "got"      (gave / got = money lent, borrowed or paid back)
   amount: for an expense this is YOUR share, which is what counts as spending.
   split:  null, or { paidBy: "me" | friend's name, total, others: [{ name, amount }] }
   auto:   null, or the id of the recurring payment that added this entry by itself */
function makeRecord(f) {
  const now = new Date().toISOString();
  return {
    id: f.id || uid(),
    kind: f.kind,
    amount: round2(f.amount || 0),
    date: f.date || todayKey(),
    category: f.category ?? null,
    note: String(f.note || "").trim(),
    mode: f.mode ?? null,
    person: f.person ? tidyName(f.person) : null,
    split: f.split ? {
      paidBy: f.split.paidBy === "me" ? "me" : tidyName(f.split.paidBy),
      total: f.split.total == null ? null : round2(f.split.total),
      others: (f.split.others || []).map(o => ({ name: tidyName(o.name), amount: round2(o.amount) })),
    } : null,
    auto: f.auto ?? null,
    createdAt: f.createdAt || now,
    updatedAt: now,
  };
}

/* A week or month as a list of day keys. offset 0 = current, -1 = previous. */
function getRange(mode, offset, weekStart) {
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start, end;
  if (mode === "week") {
    const daysIntoWeek = (today.getDay() - weekStart + 7) % 7;
    start = addDays(today, -daysIntoWeek + offset * 7);
    end = addDays(start, 6);
  } else {
    start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  }
  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(dateKey(d));
  return { mode, offset, start, end, from: days[0], to: days[days.length - 1], days };
}
function rangeLabel(r) {
  if (r.mode === "month") return fmt(r.start, { month: "long", year: "numeric" });
  const sameMonth = r.start.getMonth() === r.end.getMonth();
  return `${fmt(r.start, sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" })} – ${fmt(r.end, { day: "numeric", month: "short" })}`;
}
const rangeNick = r => r.offset === 0 ? `This ${r.mode}` : r.offset === -1 ? `Last ${r.mode}` : (r.mode === "week" ? String(r.start.getFullYear()) : "");

const inRange = (rec, r) => rec.date >= r.from && rec.date <= r.to;
const expensesIn = (records, r) => records.filter(x => x.kind === "expense" && inRange(x, r));
const sum = list => round2(list.reduce((t, x) => t + x.amount, 0));

function totalsByDay(list) {
  const out = {};
  for (const r of list) { out[r.date] = out[r.date] || { total: 0, count: 0 }; out[r.date].total = round2(out[r.date].total + r.amount); out[r.date].count++; }
  return out;
}
function totalsByCategory(list, settings) {
  const known = new Set(expenseCats(settings).map(c => c.id)), map = {};
  for (const r of list) {
    const id = known.has(r.category) ? r.category : "other";
    map[id] = map[id] || { id, total: 0, count: 0 };
    map[id].total = round2(map[id].total + r.amount); map[id].count++;
  }
  return Object.values(map).sort((a, b) => b.total - a.total);
}
function trendSeries(records, mode, weekStart, count) {
  const out = [];
  for (let off = 1 - count; off <= 0; off++) { const range = getRange(mode, off, weekStart); out.push({ range, total: sum(expensesIn(records, range)) }); }
  return out;
}

/* How a budget is doing. "warn" means 80% used, or on pace to overshoot. */
function budgetStatus(spent, limit, range) {
  const today = todayKey(), total = range.days.length;
  const isNow = range.from <= today && today <= range.to;
  const elapsed = isNow ? range.days.indexOf(today) + 1 : (range.to < today ? total : 0);
  const daysLeft = isNow ? total - elapsed + 1 : (range.to < today ? 0 : total);   // counts today
  const left = round2(limit - spent);
  const projected = isNow && elapsed ? round2(spent / elapsed * total) : spent;
  let level = "ok";
  if (spent > limit) level = "over";
  else if (spent >= limit * 0.8 || (isNow && elapsed >= 5 && projected > limit)) level = "warn";
  return { level, left, daysLeft, projected, isNow, pct: limit ? spent / limit : 0, perDay: left > 0 && daysLeft > 0 ? round2(left / daysLeft) : 0 };
}

/* Who owes whom. Every entry adds a plus or minus number against a person:
   plus = they owe you more, minus = you owe them more. The total is the balance. */
function balances(records, settings) {
  const people = new Map();
  const person = name => { const k = nameKey(name); if (!people.has(k)) people.set(k, { key: k, name: tidyName(name), net: 0, entries: [] }); return people.get(k); };
  const add = (name, delta, text, record) => { const p = person(name); p.net = round2(p.net + delta); p.entries.push({ delta, text, record }); };
  for (const r of records) {
    const what = r.note || catOf(r.category, settings).name;
    if (r.kind === "expense" && r.split) {
      if (r.split.paidBy === "me") for (const o of r.split.others) add(o.name, o.amount, `You paid for ${what}. Their share.`, r);
      else add(r.split.paidBy, -r.amount, `They paid for ${what}. Your share.`, r);
    }
    else if (r.kind === "gave") add(r.person, r.amount, r.note || "You gave them money", r);
    else if (r.kind === "got") add(r.person, -r.amount, r.note || "They gave you money", r);
  }
  return [...people.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.name.localeCompare(b.name));
}

/* One-line entry: "250 swiggy dinner yesterday" -> amount, note, category, date. */
function parseQuick(text, records) {
  const out = { amount: null, note: "", category: null, date: null }, rest = [];
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const low = word.toLowerCase(), m = low.match(/^₹?(\d+(?:[.,]\d+)*)(k)?$/);      // 250   1,200   99.50   1.5k
    if (m && out.amount === null) out.amount = round2(parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1));
    else if (low === "yesterday") out.date = dateKey(addDays(new Date(), -1));
    else if (low === "today") out.date = todayKey();
    else rest.push(word);
  }
  out.note = rest.join(" ");
  out.category = guessCategory(out.note, records);
  return out;
}
function guessCategory(note, records) {
  const text = note.trim().toLowerCase(), words = text.split(/[^a-z0-9]+/).filter(w => w.length > 2);
  if (!words.length) return null;
  const mine = records.filter(r => r.kind === "expense" && r.note);                // newest first
  const same = mine.find(r => r.note.toLowerCase() === text);                      // 1) you logged this exact note before
  if (same) return same.category;
  for (const c of EXPENSE_CATS) if (words.some(w => c.words.includes(w))) return c.id;   // 2) built-in keywords
  const skip = new Set(["with", "and", "the", "for", "from"]);
  const past = mine.find(r => { const old = r.note.toLowerCase().split(/[^a-z0-9]+/); return words.some(w => !skip.has(w) && old.includes(w)); });
  return past ? past.category : null;                                              // 3) a word you used before
}
function mostUsedCategory(records) {
  const counts = {};
  for (const r of records.slice(0, 60)) if (r.kind === "expense" && r.category) counts[r.category] = (counts[r.category] || 0) + 1;
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "food";
}

/* ---------- recurring payments ----------
   A rule looks like { id, name, amount, category, mode, every, day, next, paused }.
   "every" is the gap in months, "day" is the day of the month you picked (1 to 31)
   and "next" is the date the next payment is due. */
function nextDue(fromKey, every, day) {
  const [y, m] = fromKey.split("-").map(Number);
  const first = new Date(y, m - 1 + every, 1);                                       // the 1st of the target month
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return dateKey(new Date(first.getFullYear(), first.getMonth(), Math.min(day, lastDay)));   // the 31st becomes the 30th or 28th in short months
}
/* Every payment that has fallen due up to today, as ready-made entries, plus the
   rules moved on to their next date. It only answers; it saves nothing itself.
   Each entry gets a fixed id (rule + date), so running this twice cannot add it twice. */
function dueRecurring(rules, today) {
  const records = [];
  const moved = (rules || []).map(rule => {
    let next = rule.next, guard = 0;
    while (!rule.paused && next && next <= today && guard++ < 36) {
      records.push({ id: `auto_${rule.id}_${next}`, kind: "expense", amount: rule.amount, date: next, category: rule.category, note: rule.name, mode: rule.mode, auto: rule.id });
      next = nextDue(next, rule.every, rule.day);
    }
    return next === rule.next ? rule : { ...rule, next };
  });
  return { records, rules: moved };
}
const upcoming = (rules, today, days) => (rules || []).filter(r => !r.paused && r.next && daysBetween(today, r.next) <= days).sort((a, b) => a.next.localeCompare(b.next));
const monthlyCost = rules => round2((rules || []).filter(r => !r.paused).reduce((t, r) => t + r.amount / r.every, 0));

/* ---------- logging streak ----------
   A day counts when you added at least one entry dated that day, or marked it
   "no spend". The streak is the run of counted days ending today, or ending
   yesterday if today is still empty (so it does not look broken every morning). */
function streak(records, quietDays, today) {
  const counted = new Set([...records.filter(r => !r.auto).map(r => r.date), ...(quietDays || [])]);
  const doneToday = counted.has(today);
  let days = 0;
  for (let d = doneToday ? keyToDate(today) : addDays(keyToDate(today), -1); counted.has(dateKey(d)); d = addDays(d, -1)) days++;
  return { days, doneToday };
}

/* ---------- regulars ----------
   Things you log again and again: same note and category, at least twice in the
   last 90 days, most frequent first. The add form shows them as tap-to-fill buttons. */
function regulars(records, today, limit) {
  const from = dateKey(addDays(keyToDate(today), -90)), groups = new Map();
  for (const r of records) {                                                         // records arrive newest first
    if (r.kind !== "expense" || r.split || r.auto || !r.note || r.date < from) continue;
    const key = r.note.toLowerCase() + "|" + r.category;
    if (!groups.has(key)) groups.set(key, { note: r.note, category: r.category, amount: r.amount, mode: r.mode, count: 0 });   // keeps the latest amount
    groups.get(key).count++;
  }
  return [...groups.values()].filter(g => g.count >= 2).sort((a, b) => b.count - a.count).slice(0, limit);
}

/* Time to nudge for a backup? Only once there is something worth losing. */
function backupDue(records, settings, today) {
  if (records.length < 15) return false;
  return !settings.lastBackup || daysBetween(settings.lastBackup, today) >= 14;
}

/* Example entries shown only while the ledger is empty. They are never saved. */
function demoRecords() {
  const menu = [["Mess lunch", 90, "food"], ["Chai and samosa", 35, "food"], ["Auto to campus", 60, "transport"], ["Swiggy dinner", 240, "food"],
    ["Movie night", 320, "fun"], ["Blinkit snacks", 180, "groceries"], ["Mobile recharge", 299, "bills"], ["Haircut", 150, "care"],
    ["Printouts", 45, "education"], ["Gym protein", 850, "health"], ["Cafe coffee", 160, "food"], ["Uber to station", 210, "transport"]];
  let seed = 11; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const day = n => dateKey(addDays(new Date(), -n)), out = [];
  for (let d = 0; d < 170; d++) for (let i = 0, n = Math.floor(rnd() * 3.4); i < n; i++) {
    const [note, amt, category] = menu[Math.floor(rnd() * menu.length)];
    out.push(makeRecord({ id: `demo${d}_${i}`, kind: "expense", amount: Math.round(amt * (0.7 + rnd() * 0.7) / 5) * 5, date: day(d), category, note, mode: rnd() > 0.25 ? "upi" : "cash", createdAt: `demo${i}` }));
  }
  out.push(makeRecord({ id: "demo_split", kind: "expense", amount: 180, date: day(1), category: "food", note: "Cafe with Aarav", mode: "upi", split: { paidBy: "me", total: 520, others: [{ name: "Aarav", amount: 340 }] } }));
  out.push(makeRecord({ id: "demo_owe", kind: "expense", amount: 150, date: day(3), category: "fun", note: "Bowling", split: { paidBy: "Meera", total: null, others: [] } }));
  return out.sort(newestFirst);
}
const newestFirst = (a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt);
function demoRules() {
  const rule = (id, name, amount, every, inDays) => { const due = addDays(new Date(), inDays); return { id, name, amount, category: "bills", mode: "upi", every, day: due.getDate(), next: dateKey(due), paused: false }; };
  return [rule("demo_r1", "Spotify", 119, 1, 4), rule("demo_r2", "Mobile recharge", 299, 3, 19)];
}

/* =====================================================================
   4. STORE  -  where the data lives.
   Everything sits in ONE slot of this browser's localStorage, as text:
       { records: { id: entry, ... }, settings: { ... } }
   The rest of the app never touches localStorage. It only calls
   store.putRecords, store.removeRecord, store.putSettings and store.wipe.
   So if you ever want sync (Supabase, Google Drive...), you write a second
   "backend" with those same four functions and swap it in inside boot().
   ===================================================================== */
const state = { ready: false, backend: "loading", persisted: null, records: [], settings: { ...DEFAULT_SETTINGS } };
let store = null;

/* Stored settings may come from an older version or a hand-edited backup:
   fill in anything missing and drop anything malformed, so the screens can trust them. */
function cleanSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) }, list = x => Array.isArray(x) ? x : [];
  s.budgets = { total: Number(s.budgets?.total) || 0, cats: { ...(s.budgets?.cats || {}) } };
  s.customCats = list(s.customCats).filter(c => c && c.id && c.name);
  s.recurring = list(s.recurring).filter(r => r && r.id && r.name && r.amount > 0 && r.every > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.next || ""));
  s.quietDays = list(s.quietDays).filter(d => typeof d === "string");
  if (!["auto", "light", "dark"].includes(s.theme)) s.theme = "auto";
  return s;
}

/* Every change ends here: tidy the data, remember it, redraw the screen. */
function onData(records, settings) {
  state.records = records.filter(r => r && r.id && typeof r.date === "string").sort(newestFirst);
  state.settings = cleanSettings(settings);
  state.ready = true;
  const root = document.documentElement;                                             // "auto" follows the phone's light or dark setting
  state.settings.theme === "auto" ? root.removeAttribute("data-theme") : root.setAttribute("data-theme", state.settings.theme);
  render();
}

function readLocal() {
  let raw;
  try { raw = localStorage.getItem(LOCAL_KEY); } catch (e) { return null; }          // storage is blocked
  try { return { records: {}, settings: {}, ...JSON.parse(raw || "{}") }; } catch (e) { return { records: {}, settings: {} }; }
}

function localBackend() {
  let data = readLocal(), saving = !!data;
  data = data || { records: {}, settings: {} };
  const show = () => onData(Object.values(data.records), data.settings);
  const flush = () => {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); } catch (e) { saving = false; state.backend = "memory"; }
    show();
  };
  // Hisaab open twice (a browser tab and the installed app)? When one saves, the other reloads its copy.
  window.addEventListener("storage", e => { if (e.key === LOCAL_KEY && saving) { data = readLocal() || data; show(); } });
  return {
    get name() { return saving ? "local" : "memory"; },
    start() { show(); },
    async putRecords(list) { for (const r of list) data.records[r.id] = r; flush(); },
    async removeRecord(r) { delete data.records[r.id]; flush(); },
    async putSettings(s) { data.settings = s; flush(); },
    async wipe() { data = { records: {}, settings: {} }; flush(); },
  };
}

/* Start-up: open the storage, draw the screen, then do the housekeeping. */
function boot() {
  render();
  store = localBackend();
  state.backend = store.name;
  store.start();
  postRecurring();
  if (location.hash === "#add") {                                                    // the "Add entry" shortcut on the app icon
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* the address is optional */ }
    openEntry();
  }
  startAppShell();
}

async function save(records, message) {
  if (message) toast(message);
  try { await store.putRecords(records); }
  catch (e) { toast("Could not save. Try again."); }
}
async function saveSettings(next) {
  try { await store.putSettings({ ...next, updatedAt: new Date().toISOString() }); }
  catch (e) { toast("Could not save. Try again."); }
}

/* Add any recurring payments that fell due since the app was last open. */
async function postRecurring() {
  const { records, rules } = dueRecurring(state.settings.recurring, todayKey());
  if (!records.length) return;
  await store.putRecords(records.map(makeRecord));                                   // entries first, then move the rules forward
  await saveSettings({ ...state.settings, recurring: rules });
  toast(records.length === 1 ? `Added your recurring payment: ${records[0].note}` : `Added ${records.length} recurring payments`);
}

/* =====================================================================
   5. SCREENS  -  each view is a function that turns data into HTML text.
   render() redraws the current screen whenever data or a filter changes.
   ===================================================================== */
const ui = { tab: "overview", period: "week", offset: 0, budgetOffset: 0, shown: 80, filter: { kind: "all", cat: null, q: "", range: null } };
const DEMO = demoRecords(), DEMO_RULES = demoRules();
const hasBudget = s => s.budgets.total > 0 || Object.keys(s.budgets.cats).length > 0;

/* What the screens should show: your data, or the examples while it is empty. */
function current() {
  if (state.records.length) return { records: state.records, settings: state.settings, demo: false };
  let settings = hasBudget(state.settings) ? state.settings : { ...state.settings, budgets: { total: 9000, cats: { food: 4000, fun: 1500 } } };
  if (!settings.recurring.length) settings = { ...settings, recurring: DEMO_RULES };
  return { records: DEMO, settings, demo: true };
}

/* render() is the only way a screen gets drawn. If drawing ever fails (bad data, or a
   mistake in a code change), it says so and offers a backup instead of a blank page. */
function render() {
  try { draw(); }
  catch (e) {
    console.error(e);
    $("#view").innerHTML = `<div class="page"><section class="card"><h2>This screen could not be drawn</h2>
      <p class="hint">Your entries are still saved on this device. Download a backup, then reload. If the code was changed recently, that change is the likely cause.</p>
      <p class="hint">Error: ${esc(e.message)}</p>
      <div class="actions"><button class="btn primary" data-act="export-json">Download backup</button><button class="btn" data-act="reload">Reload</button></div></section></div>`;
  }
}
function draw() {
  const names = { loading: ["", "Opening…"], local: ["ok", "On this device"], memory: ["bad", "Not saving"] }[state.backend];
  const status = $("#status"); status.className = "status " + names[0]; status.innerHTML = `<i></i>${names[1]}`;
  $$(".tab[data-tab]").forEach(t => t.dataset.tab === ui.tab ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current"));

  const main = $("#view");
  if (!state.ready) {
    main.innerHTML = `<div class="page"><p class="loading">Opening your ledger…</p></div>`;
    return;
  }
  const v = current();
  if (ui.tab === "history" && document.activeElement?.id === "h-search") { $("#history-list").innerHTML = historyList(v); return; }
  main.innerHTML = `<div class="page">${banners(v)}${VIEWS[ui.tab](v)}</div>`;
}

function banners(v) {
  let out = "";
  if (state.backend === "memory") out += `<div class="banner warn"><span><b>Nothing is being saved.</b> This browser is blocking storage, so entries will vanish when you close the page.</span></div>`;
  if (v.demo) out += `<div class="banner"><span><b>These are example entries</b> so you can see how it works. They disappear when you add your first one.</span><button class="btn small primary" data-act="add">Add my first entry</button></div>`;
  else if (ui.tab === "overview" && backupDue(state.records, state.settings, todayKey())) {
    const last = state.settings.lastBackup;
    out += `<div class="banner warn"><span><b>Time for a backup.</b> Your ${entries(state.records.length)} live only on this device. ${last ? `The last backup was ${daysBetween(last, todayKey())} days ago.` : "You have not made one yet."}</span><button class="btn small" data-act="export-json">Download backup</button></div>`;
  }
  return out;
}

function barChart(items, pick, act) {
  const max = Math.max(0, ...items.map(i => i.value));
  const height = v => max && v ? Math.max(v / max * 100, 2) : 0;
  return `<div class="chart">
    <p class="readout"><strong data-readout-value>${inr(items[pick].value)}</strong><span data-readout-label>${esc(items[pick].readout)}</span></p>
    <div class="plot">
      <span class="grid g-top"><em>${max ? inrShort(max) : ""}</em></span><span class="grid g-mid"><em>${max ? inrShort(max / 2) : ""}</em></span><span class="grid g-base"><em>₹0</em></span>
      <div class="cols" style="--n:${items.length}">${items.map((it, i) => `<button type="button" class="col${i === pick ? " is-picked" : ""}" data-act="${act}" data-i="${i}" data-jump="${it.jump ?? ""}" data-value="${inr(it.value)}" data-label="${esc(it.readout)}" aria-label="${esc(it.readout)}: ${inr(it.value)}"><span class="bar" style="height:${height(it.value)}%"></span></button>`).join("")}</div>
    </div>
    <div class="ticks" style="--n:${items.length}">${items.map((it, i) => `<span class="${i === pick ? "is-picked" : ""}">${esc(it.tick)}</span>`).join("")}</div>
  </div>`;
}

function recordRow(r, s) {
  const c = catOf(r.category, s);
  let icon = c.icon, title = r.note || c.name, meta = [], sub = "";
  if (r.kind === "expense") {
    meta.push(c.name); if (r.mode) meta.push(modeName(r.mode));
    if (r.split?.paidBy === "me") { meta.push(`split with ${r.split.others.map(o => o.name).join(", ")}`); sub = `<small>of ${inr(r.split.total)} bill</small>`; }
    else if (r.split) { meta.push(`${r.split.paidBy} paid`); sub = `<small>your share</small>`; }
    if (r.auto) meta.push("added automatically");
  }
  else { icon = r.kind === "gave" ? "↗" : "↙"; title = r.kind === "gave" ? `Gave ${r.person}` : `Got from ${r.person}`; meta.push(r.note || "Lent / borrowed"); sub = `<small>not spending</small>`; }
  return `<button class="row" data-act="edit" data-id="${esc(r.id)}"><span class="row-icon" aria-hidden="true">${esc(icon)}</span>
    <span class="row-main"><span class="row-title">${esc(title)}</span><span class="row-meta">${esc(meta.join(" · "))}</span></span>
    <span class="row-amt">${inr(r.amount)}${sub}</span></button>`;
}

const pill = (level, text) => `<span class="pill ${level}"><i aria-hidden="true">${{ ok: "●", warn: "▲", over: "■" }[level]}</i>${text}</span>`;
const stepper = (act, range, canGoNext) => `<div class="stepper">
  <button class="icon-btn" data-act="${act}" data-d="-1" aria-label="Previous ${range.mode}"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
  <p>${rangeLabel(range)}<small>${rangeNick(range)}</small></p>
  <button class="icon-btn" data-act="${act}" data-d="1" aria-label="Next ${range.mode}" ${canGoNext ? "" : "disabled"}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>`;

/* One recurring payment as a row (used on the Budget screen and in "Coming up"). */
function ruleRow(rule, s, today) {
  const c = catOf(rule.category, s), gap = daysBetween(today, rule.next);
  const when = rule.paused ? "Paused" : gap <= 0 ? "Due today" : gap === 1 ? "Due tomorrow" : `Due ${dayLabel(rule.next)}`;
  const every = (REPEATS.find(x => x.every === rule.every) || REPEATS[0]).name.toLowerCase();
  return `<button class="row" data-act="recur" data-id="${esc(rule.id)}"><span class="row-icon" aria-hidden="true">${esc(c.icon)}</span>
    <span class="row-main"><span class="row-title">${esc(rule.name)}</span><span class="row-meta">${esc(when)} · ${every}</span></span>
    <span class="row-amt">${inr(rule.amount)}</span></button>`;
}

/* The strip under the Week / Month buttons: your logging streak, and a nudge while today is still empty. */
function streakStrip(run, today) {
  const count = `<span class="streak-count"><b>${run.days}</b>${run.days === 1 ? "day" : "days"} in a row</span>`;
  if (state.records.some(r => r.date === today && !r.auto)) return `<div class="streak">${count}<span class="streak-note">Today is logged.</span></div>`;
  if (run.doneToday) return `<div class="streak">${count}<span class="streak-note">Today is marked as a no-spend day.</span><button class="btn small" data-act="quiet-today">Undo</button></div>`;
  return `<div class="streak">${count}<span class="streak-note">${run.days ? "Nothing logged today yet." : "Log every day to build a streak."}</span><button class="btn small" data-act="quiet-today">No spend today</button></div>`;
}

const VIEWS = {
  /* ---------- Overview: how much, when, on what ---------- */
  overview(v) {
    const s = v.settings, unit = ui.period, range = getRange(unit, ui.offset, s.weekStart), today = todayKey(), isNow = ui.offset === 0;
    const list = expensesIn(v.records, range), spent = sum(list), byDay = totalsByDay(list);
    const elapsed = isNow ? range.days.indexOf(today) + 1 : range.days.length;

    // compare like with like: the same number of days of the period before
    const prev = getRange(unit, ui.offset - 1, s.weekStart), prevDays = new Set(isNow ? prev.days.slice(0, elapsed) : prev.days);
    const prevSpent = sum(v.records.filter(r => r.kind === "expense" && prevDays.has(r.date)));
    const diff = round2(spent - prevSpent), versus = isNow ? `this point last ${unit}` : `the ${unit} before`;
    const delta = !prevSpent ? "" : diff === 0 ? `Same as ${versus}`
      : `<span class="arrow" aria-hidden="true">${diff > 0 ? "▲" : "▼"}</span> ${inr(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${versus}`;

    const run = !v.demo && isNow ? streak(state.records, s.quietDays, today) : null;
    const soon = upcoming(s.recurring, today, 14);
    const biggest = list.reduce((m, r) => (!m || r.amount > m.amount ? r : m), null);
    const quiet = range.days.slice(0, elapsed).filter(d => !byDay[d]).length;
    let budget = "";
    if (unit === "month" && s.budgets.total) {
      const b = budgetStatus(spent, s.budgets.total, range);
      budget = `<div class="hero-budget"><span class="meter ${b.level}"><span style="width:${Math.min(b.pct, 1) * 100}%"></span></span>
        <span>${b.left >= 0 ? `<b>${inr(b.left)}</b> left of ${inr(s.budgets.total)}` : `<b>${inr(-b.left)}</b> over your ${inr(s.budgets.total)} budget`}${b.perDay ? ` · about ${inr(Math.floor(b.perDay))} a day for ${b.daysLeft} more ${b.daysLeft === 1 ? "day" : "days"}` : ""}</span></div>`;
    }

    const dayItems = range.days.map(d => ({ value: byDay[d]?.total || 0,
      tick: unit === "week" ? fmt(keyToDate(d), { weekday: "short" }) : ([1, 5, 10, 15, 20, 25, 30].includes(+d.slice(8)) ? String(+d.slice(8)) : ""),
      readout: `${dayLabel(d)}${d === today ? " (today)" : ""} · ${d > today ? "not here yet" : entries(byDay[d]?.count || 0)}` }));
    const peak = dayItems.reduce((best, it, i) => it.value > dayItems[best].value ? i : best, 0);

    const cats = totalsByCategory(list, s), top = cats[0]?.total || 1;
    const trend = trendSeries(v.records, unit, s.weekStart, 6).map(t => ({ value: t.total, jump: t.range.offset,
      tick: unit === "week" ? fmt(t.range.start, { day: "numeric", month: "short" }) : fmt(t.range.start, { month: "short" }),
      readout: `${rangeLabel(t.range)}${t.range.offset === 0 ? " (so far)" : ""}` }));
    const trendPick = Math.max(0, trend.findIndex(t => t.jump === ui.offset));

    const people = balances(v.records, s), owed = round2(people.filter(p => p.net > 0).reduce((t, p) => t + p.net, 0)), owe = round2(people.filter(p => p.net < 0).reduce((t, p) => t - p.net, 0));

    return `<div class="period">
        <div class="seg">${["week", "month"].map(m => `<button data-act="period" data-mode="${m}" aria-pressed="${unit === m}">${m === "week" ? "Week" : "Month"}</button>`).join("")}</div>
        ${stepper("step", range, ui.offset < 0)}
      </div>
      ${run ? streakStrip(run, today) : ""}
      <div class="overview">
        <div class="stack">
          <section class="hero" aria-label="Total spent">
            <p class="eyebrow">Spent · ${rangeLabel(range)}</p>
            <p class="total">${inr(spent)}</p>
            ${delta ? `<p class="delta ${diff > 0 ? "up" : "down"}">${delta}</p>` : ""}
            ${budget}
            <dl class="stats">
              <div><dt>Average a day</dt><dd>${inr(elapsed ? Math.round(spent / elapsed) : 0)}</dd></div>
              <div><dt>Biggest spend</dt><dd>${biggest ? inr(biggest.amount) : "₹0"}<small>${biggest ? esc(biggest.note || catOf(biggest.category, s).name) : "nothing yet"}</small></dd></div>
              <div><dt>No-spend days</dt><dd>${quiet}</dd></div>
            </dl>
          </section>
          <section class="card"><h2>Day by day</h2>${barChart(dayItems, isNow ? Math.max(0, range.days.indexOf(today)) : peak, "pick-bar")}</section>
          <section class="card"><div class="card-head"><h2>${unit === "week" ? "Last 6 weeks" : "Last 6 months"}</h2><small>Tap a bar to open that ${unit}</small></div>${barChart(trend, trendPick, "pick-period")}</section>
        </div>
        <div class="stack">
          <section class="card"><h2>Where it went</h2>
            ${cats.length ? `<div class="rows">${cats.map(c => { const cat = catOf(c.id, s); return `<button class="row" data-act="filter-cat" data-cat="${esc(c.id)}"><span class="row-icon" aria-hidden="true">${esc(cat.icon)}</span>
              <span class="row-main wide"><span class="cat-line"><span class="row-title">${esc(cat.name)}</span><b>${inr(c.total)}</b></span>
              <span class="meter"><span style="width:${c.total / top * 100}%"></span></span>
              <span class="row-meta">${entries(c.count)} · ${Math.round(c.total / spent * 100)}% of spending</span></span></button>`; }).join("")}</div>`
            : `<p class="empty">Nothing spent in this ${unit}.</p>`}
          </section>
          ${soon.length ? `<section class="card"><div class="card-head"><h2>Coming up</h2><button class="link" data-act="go" data-tab="budget">All recurring</button></div>
            <div class="rows">${soon.slice(0, 4).map(r => ruleRow(r, s, today)).join("")}</div></section>` : ""}
          ${owed || owe ? `<section class="card"><div class="card-head"><h2>With friends</h2><button class="link" data-act="go" data-tab="people">Open People</button></div>
            <dl class="two"><div><dt>They owe you</dt><dd class="plus">${inr(owed)}</dd></div><div><dt>You owe</dt><dd class="minus">${inr(owe)}</dd></div></dl></section>` : ""}
          <section class="card"><div class="card-head"><h2>Latest entries</h2><button class="link" data-act="go" data-tab="history">See all</button></div>
            <div class="rows">${v.records.slice(0, 6).map(r => recordRow(r, s)).join("")}</div></section>
        </div>
      </div>`;
  },

  /* ---------- History: every entry, searchable ---------- */
  history(v) {
    const f = ui.filter, s = v.settings;
    const kinds = [["all", "All"], ["spent", "Spending"], ["people", "Friends"]];
    return `<section class="card">
        <div class="search">
          <input type="search" id="h-search" placeholder="Search notes, people, amounts" value="${esc(f.q)}" aria-label="Search entries">
          <div class="seg">${kinds.map(([id, name]) => `<button data-act="filter-kind" data-kind="${id}" aria-pressed="${f.kind === id}">${name}</button>`).join("")}</div>
        </div>
        ${f.cat || f.range ? `<div class="chips">${f.cat ? `<button class="chip" data-act="clear-filter" data-key="cat" aria-pressed="true">${esc(catOf(f.cat, s).name)} ✕</button>` : ""}${f.range ? `<button class="chip" data-act="clear-filter" data-key="range" aria-pressed="true">${rangeLabel(f.range)} ✕</button>` : ""}</div>` : ""}
        <div id="history-list">${historyList(v)}</div>
      </section>`;
  },

  /* ---------- Budget: limits for the month ---------- */
  budget(v) {
    const s = v.settings, range = getRange("month", ui.budgetOffset, s.weekStart);
    const list = expensesIn(v.records, range), spent = sum(list), per = Object.fromEntries(totalsByCategory(list, s).map(c => [c.id, c.total]));
    const words = { ok: "On track", warn: "Watch it", over: "Over" };
    let overall;
    if (s.budgets.total) {
      const b = budgetStatus(spent, s.budgets.total, range);
      overall = `<div class="card-head"><h2>Monthly budget</h2>${pill(b.level, words[b.level])}</div>
        <p class="total" style="font-size:36px">${inr(spent)} <small style="font-size:15px;letter-spacing:0">of ${inr(s.budgets.total)}</small></p>
        <span class="meter ${b.level}"><span style="width:${Math.min(b.pct, 1) * 100}%"></span></span>
        <p class="hint">${b.left >= 0 ? `${inr(b.left)} left.` : `${inr(-b.left)} over.`}${b.perDay ? ` That is about ${inr(Math.floor(b.perDay))} a day for the ${b.daysLeft} ${b.daysLeft === 1 ? "day" : "days"} left.` : ""}${b.isNow && b.level !== "over" && b.projected > s.budgets.total ? ` At this pace you would end the month near ${inr(Math.round(b.projected))}.` : ""}</p>
        <div class="actions"><button class="btn small" data-act="limit">Change budget</button></div>`;
    } else {
      overall = `<h2>Monthly budget</h2><p class="hint">You have spent ${inr(spent)} this month. Set one number for the whole month and Hisaab will tell you how much is left per day.</p>
        <div class="actions"><button class="btn primary" data-act="limit">Set a monthly budget</button></div>`;
    }
    const rows = expenseCats(s).map(c => ({ c, spent: per[c.id] || 0, limit: s.budgets.cats[c.id] || 0 }))
      .sort((a, b) => (b.limit > 0) - (a.limit > 0) || b.spent - a.spent)
      .map(({ c, spent, limit }) => {
        const b = limit ? budgetStatus(spent, limit, range) : null;
        return `<button class="row" data-act="limit" data-cat="${esc(c.id)}"><span class="row-icon" aria-hidden="true">${esc(c.icon)}</span>
          <span class="row-main wide"><span class="cat-line"><span class="row-title">${esc(c.name)}</span>${b ? pill(b.level, words[b.level]) : ""}</span>
          ${b ? `<span class="meter ${b.level}"><span style="width:${Math.min(b.pct, 1) * 100}%"></span></span>` : ""}
          <span class="row-meta">${b ? `${inr(spent)} of ${inr(limit)} · ${b.left >= 0 ? inr(b.left) + " left" : inr(-b.left) + " over"}` : `${inr(spent)} spent · no limit, tap to set one`}</span></span></button>`;
      }).join("");
    const rules = (s.recurring || []).slice().sort((a, b) => (a.paused - b.paused) || a.next.localeCompare(b.next));
    const recurring = `<section class="card"><div class="card-head"><h2>Recurring payments</h2><button class="btn small" data-act="recur">Add one</button></div>
      ${rules.length ? `<p class="hint">About ${inr(Math.round(monthlyCost(rules)))} a month goes out by itself. Each one is added to your entries on its due date.</p>
        <div class="rows">${rules.map(r => ruleRow(r, s, todayKey())).join("")}</div>`
      : `<p class="empty">Subscriptions, recharges, rent. Add each one once and Hisaab enters it for you on the due date.</p>`}</section>`;
    return `<div class="period"><h1 class="page-title">Budget</h1>${stepper("bstep", range, ui.budgetOffset < 0)}</div>
      <div class="overview"><div class="stack"><section class="card">${overall}</section>${recurring}</div>
      <section class="card"><h2>Limits by category</h2><div class="rows">${rows}</div></section></div>`;
  },

  /* ---------- People: who owes whom ---------- */
  people(v) {
    const people = balances(v.records, v.settings);
    const owed = round2(people.filter(p => p.net > 0).reduce((t, p) => t + p.net, 0)), owe = round2(people.filter(p => p.net < 0).reduce((t, p) => t - p.net, 0));
    return `<div class="overview"><section class="card">
        <div class="card-head"><h2>With friends</h2><button class="btn small" data-act="add-people">Record a loan</button></div>
        <dl class="two"><div><dt>They owe you</dt><dd class="plus">${inr(owed)}</dd></div><div><dt>You owe</dt><dd class="minus">${inr(owe)}</dd></div></dl>
        ${people.length ? `<div class="rows">${people.map(p => `<button class="row" data-act="person" data-key="${esc(p.key)}"><span class="row-icon" aria-hidden="true">${esc(p.name[0])}</span>
          <span class="row-main"><span class="row-title">${esc(p.name)}</span><span class="row-meta">${entries(p.entries.length)}</span></span>
          <span class="row-amt ${p.net > 0 ? "plus" : p.net < 0 ? "minus" : ""}">${p.net ? inr(Math.abs(p.net)) : "Settled"}<small>${p.net > 0 ? "owes you" : p.net < 0 ? "you owe" : ""}</small></span></button>`).join("")}</div>`
        : `<p class="empty">No one here yet. When you add a shared bill or a loan, the person shows up with a running balance.</p>`}
      </section>
      <section class="card"><h2>How shared bills work</h2><ol class="steps">
        <li>You paid for the table: enter the full bill, then what each friend's own items cost. The rest is your share, and only that counts as your spending.</li>
        <li>A friend paid: enter only your share. It counts as your spending and shows as money you owe them.</li>
        <li>When money changes hands, open the person and tap Settle up.</li></ol></section></div>`;
  },

  /* ---------- Setup: storage, backup, install, categories, preferences ---------- */
  setup(v) {
    const s = state.settings, saved = state.backend !== "memory";
    const kept = { true: "yes", false: "not yet. Installing the app, or simply using it regularly, turns this on" }[state.persisted] || "this browser does not say";
    const install = shell.installed ? `<p class="hint">Hisaab is installed on this device. Open it from your home screen or app list.</p>`
      : shell.installEvent ? `<p class="hint">Put Hisaab on your home screen. It opens full screen like any app and works with no internet.</p><div class="actions"><button class="btn primary" data-act="install">Install Hisaab</button></div>`
      : location.protocol === "file:" ? `<p class="hint">Installing works once Hisaab is on a web address. The README has the GitHub Pages steps.</p>`
      : `<p class="hint">On Android, open the Chrome menu (⋮) and choose <b>Add to Home screen</b> or <b>Install app</b>. On iPhone, open this page in Safari, tap Share, then <b>Add to Home Screen</b>.</p>`;
    return `<div class="overview"><div class="stack">
        <section class="card"><h2>Where your data lives</h2><p><b>${saved ? "On this device, in this browser" : "Nothing is being saved"}.</b></p>
          <p class="hint">${saved ? "Entries are kept in this browser's own storage. Nothing is sent anywhere: there is no account and no server. That also means entries do not sync to your other devices, and clearing browser data or removing the app deletes them. A backup file is your safety net." : "This browser is blocking storage. Entries will be lost when you close the page."}</p>
          ${saved ? `<p class="hint">Protected from the browser's automatic clean-up: ${kept}.</p>` : ""}</section>
        <section class="card"><h2>Backup and export</h2><p class="hint">${entries(state.records.length)} in your ledger. ${s.lastBackup ? `Last backup: ${dayLabel(s.lastBackup)}.` : "No backup made yet."} The backup file brings everything back later, on this device or a new one. The spreadsheet file opens in Excel or Google Sheets.</p>
          <div class="actions"><button class="btn primary" data-act="export-json">Download backup (.json)</button><button class="btn" data-act="export-csv">Download spreadsheet (.csv)</button><button class="btn" data-act="restore">Restore from backup</button></div></section>
        <section class="card"><h2>Install as an app</h2>${install}</section>
        <section class="card"><h2>Start over</h2><p class="hint">Deletes every entry, budget, recurring payment and custom category. Download a backup first if you might want them back.</p>
          <div class="actions"><button class="btn danger" data-act="wipe">Delete everything</button></div></section>
      </div><div class="stack">
        <section class="card"><div class="card-head"><h2>Categories</h2><button class="btn small" data-act="new-cat">Add category</button></div>
          <div class="chips">${EXPENSE_CATS.map(c => `<span class="chip static">${c.icon} ${esc(c.name)}</span>`).join("")}${(s.customCats || []).map(c => `<button class="chip" data-act="del-cat" data-cat="${esc(c.id)}" aria-label="Remove ${esc(c.name)}">${esc(c.icon)} ${esc(c.name)} ✕</button>`).join("")}</div></section>
        <section class="card"><h2>Preferences</h2>
          <div class="field"><span class="label">Week starts on</span><div class="seg">${[[1, "Monday"], [0, "Sunday"]].map(([d, n]) => `<button data-act="pref" data-key="weekStart" data-value="${d}" aria-pressed="${s.weekStart === d}">${n}</button>`).join("")}</div></div>
          <div class="field"><span class="label">Colours</span><div class="seg">${[["auto", "Match phone"], ["light", "Light"], ["dark", "Dark"]].map(([id, n]) => `<button data-act="pref" data-key="theme" data-value="${id}" aria-pressed="${s.theme === id}">${n}</button>`).join("")}</div></div>
          <div class="field"><span class="label">I usually pay with</span><div class="seg">${MODES.map(m => `<button data-act="pref" data-key="defaultMode" data-value="${m.id}" aria-pressed="${s.defaultMode === m.id}">${m.name}</button>`).join("")}</div></div></section>
        <section class="card"><h2>How Hisaab works</h2><ol class="steps"><li>You add an entry. It is one small record: amount, date, category, note.</li><li>The record is saved to this browser's storage, and every screen is redrawn from the full list of records.</li><li>Totals are never stored. Week, month, budget and friend balances are worked out fresh from the records each time, so they cannot drift out of step.</li></ol></section>
      </div></div>`;
  },
};

function historyList(v) {
  const f = ui.filter, s = v.settings, q = f.q.trim().toLowerCase();
  const list = v.records.filter(r =>
    (f.kind === "all" || (f.kind === "spent" && r.kind === "expense") || (f.kind === "people" && (r.kind === "gave" || r.kind === "got" || r.split))) &&
    (!f.cat || (r.kind === "expense" && (r.category === f.cat || (f.cat === "other" && catOf(r.category, s).id === "other")))) &&
    (!f.range || inRange(r, f.range)) &&
    (!q || [r.note, r.person, catOf(r.category, s).name, r.split?.paidBy, ...(r.split?.others || []).map(o => o.name), r.amount].join(" ").toLowerCase().includes(q)));
  if (!list.length) return `<p class="empty">No entries match. Clear the search or filters to see everything.</p>`;
  const spent = sum(list.filter(r => r.kind === "expense"));
  let html = `<p class="hint">${entries(list.length)} · ${inr(spent)} spent</p><div class="rows">`, last = "";
  for (const r of list.slice(0, ui.shown)) {
    if (r.date !== last) {
      const dayTotal = sum(list.filter(x => x.date === r.date && x.kind === "expense"));
      html += `<p class="day"><span>${dayLabel(r.date)}${r.date === todayKey() ? " · today" : ""}</span><span>${inr(dayTotal)}</span></p>`; last = r.date;
    }
    html += recordRow(r, s);
  }
  html += `</div>`;
  if (list.length > ui.shown) html += `<div class="actions"><button class="btn small" data-act="more">Show older entries</button></div>`;
  return html;
}

/* =====================================================================
   6. SHEETS  -  the pop-up forms (add/edit entry, person, limits, confirm).
   ===================================================================== */
const CLOSE = `<button type="button" class="icon-btn" data-act="close-sheet" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;

function openSheet(html) {
  const root = $("#sheet-root");
  $("#toast").textContent = "";
  if (!root.firstChild) { try { history.pushState({ sheet: true }, ""); } catch (e) { /* history is optional */ } }   // gives the Back button something to undo
  root.innerHTML = `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  root.firstElementChild.addEventListener("pointerdown", e => { if (e.target.classList.contains("scrim")) closeSheet(); });
  return $(".sheet", root);
}
function closeSheet() {
  if (!$("#sheet-root").firstChild) return;
  $("#sheet-root").innerHTML = "";
  try { if (history.state?.sheet) history.back(); } catch (e) { /* history is optional */ }
}

let toastTimer;
function toast(message, action) {
  const box = $("#toast"); box.textContent = message;
  if (action) { const b = document.createElement("button"); b.textContent = action.label; b.onclick = () => { box.textContent = ""; action.run(); }; box.append(b); }
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { box.textContent = ""; }, action ? 7000 : 3200);
}

function confirmSheet(title, body, label, run) {
  const sheet = openSheet(`<div class="sheet-head"><h2>${esc(title)}</h2>${CLOSE}</div><p class="hint">${esc(body)}</p>
    <div class="actions"><button class="btn grow" data-act="close-sheet">Cancel</button><button class="btn danger grow" id="confirm-yes">${esc(label)}</button></div>`);
  $("#confirm-yes", sheet).onclick = () => { closeSheet(); run(); };
}

/* The add / edit form. "existing" is the record being edited; "preset" pre-fills a new one. */
function openEntry(existing = null, preset = {}) {
  const v = current(), s = state.settings, src = existing || preset;
  const draft = {
    kind: src.kind === "gave" || src.kind === "got" ? "people" : (src.kind || "expense"),
    dir: src.kind === "got" ? "got" : "gave",
    category: src.category || null,
    mode: src.mode || s.defaultMode,
    splitOn: !!src.split,
    payer: src.split && src.split.paidBy !== "me" ? "friend" : "me",
  };
  const names = balances(state.records, s).map(p => p.name);
  const sheet = openSheet(`<div class="sheet-head"><h2>${existing ? "Edit entry" : "New entry"}</h2>${CLOSE}</div>
    <form id="entry" novalidate autocomplete="off">
      <div class="seg wide" id="f-kind"><button type="button" data-kind="expense">Spent</button><button type="button" data-kind="people">Lent / borrowed</button></div>
      <div class="field" id="sec-regulars"><span class="label">Tap one you log often</span><div class="chips" id="f-regulars"></div></div>
      <div class="field" id="sec-quick"><label for="f-quick">Type it in one line</label><input id="f-quick" placeholder="250 swiggy dinner" enterkeyhint="done"></div>
      <div class="field"><label for="f-amount" id="amount-label">Amount</label><div class="money big"><span>₹</span><input id="f-amount" inputmode="decimal" placeholder="0"></div></div>
      <div class="field" id="sec-dir"><span class="label">Which way did the money go?</span>
        <div class="seg wide" id="f-dir"><button type="button" data-dir="gave">I gave money</button><button type="button" data-dir="got">I got money</button></div>
        <label for="f-person">Person</label><input id="f-person" list="people-list" placeholder="Name">
        <p class="hint">Lending and paying back are not spending, so they stay out of your totals.</p></div>
      <div class="field" id="sec-cats"><span class="label">Category</span><div class="chips" id="f-cats"></div></div>
      <div class="field"><label for="f-note">Note</label><input id="f-note" placeholder="What was it?"></div>
      <div class="field"><label for="f-date">Date</label><div class="date-row"><input type="date" id="f-date"><button type="button" class="chip" data-day="0">Today</button><button type="button" class="chip" data-day="-1">Yesterday</button></div></div>
      <div class="field" id="sec-mode"><span class="label">Paid with</span><div class="seg" id="f-mode">${MODES.map(m => `<button type="button" data-mode="${m.id}">${m.name}</button>`).join("")}</div></div>
      <div class="split" id="sec-split">
        <label class="check"><input type="checkbox" id="f-split"><span>This was a shared bill</span></label>
        <div class="split-body" id="split-body">
          <div class="seg wide" id="f-payer"><button type="button" data-payer="me">I paid the bill</button><button type="button" data-payer="friend">A friend paid</button></div>
          <div id="split-me">
            <p class="hint">Put the full bill in Amount. Then enter what each friend's own items cost. Whatever is left is your share.</p>
            <div id="split-rows"></div>
            <div class="split-tools"><button type="button" class="btn small" id="split-add">+ Add person</button><button type="button" class="btn small" id="split-equal">Split equally</button></div>
            <p class="split-sum" id="split-sum"></p>
          </div>
          <div class="field" id="split-friend"><label for="f-payer-name">Who paid?</label><input id="f-payer-name" list="people-list" placeholder="Name">
            <p class="hint">Put only your own share in Amount. It counts as your spending, and you will owe them that much.</p></div>
        </div>
      </div>
      <datalist id="people-list">${names.map(n => `<option value="${esc(n)}"></option>`).join("")}</datalist>
      <p class="form-error" id="f-error" role="alert"></p>
      <div class="actions">${existing ? `<button type="button" class="btn danger" id="f-delete">Delete</button>` : ""}<button type="submit" class="btn primary grow">${existing ? "Save changes" : "Save"}</button></div>
    </form>`);

  const el = id => $("#" + id, sheet);
  const usual = existing ? [] : regulars(state.records, todayKey(), 6);            // your regulars, as tap-to-fill buttons
  el("f-regulars").innerHTML = usual.map((g, i) => `<button type="button" class="chip" data-usual="${i}">${esc(catOf(g.category, s).icon)} ${esc(g.note)} · ${inr(g.amount)}</button>`).join("");
  const addRow = (name = "", amount = "") => {
    const row = document.createElement("div"); row.className = "split-row";
    row.innerHTML = `<input class="sp-name" list="people-list" placeholder="Friend's name" aria-label="Friend's name"><div class="money"><span>₹</span><input class="sp-amt" inputmode="decimal" placeholder="Their share" aria-label="Their share"></div><button type="button" class="icon-btn" data-rm aria-label="Remove person"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    $(".sp-name", row).value = name; $(".sp-amt", row).value = amount; el("split-rows").append(row);
  };
  const readRows = () => $$(".split-row", sheet).map(r => ({ name: $(".sp-name", r).value.trim(), amount: num($(".sp-amt", r).value) }));

  // fill the form from the record being edited (or the preset)
  el("f-amount").value = src.split?.paidBy === "me" ? src.split.total : (src.amount || "");
  el("f-note").value = src.note || ""; el("f-date").value = src.date || todayKey(); el("f-person").value = src.person || "";
  el("f-split").checked = draft.splitOn;
  if (src.split?.paidBy === "me") src.split.others.forEach(o => addRow(o.name, o.amount));
  else if (src.split) el("f-payer-name").value = src.split.paidBy;

  /* sync(): make the form match the draft. Shows and hides sections, marks the chosen buttons. */
  const sync = () => {
    const isExp = draft.kind === "expense", isPeople = draft.kind === "people", cats = expenseCats(s);
    if (isExp && !cats.some(c => c.id === draft.category)) draft.category = mostUsedCategory(state.records);
    const press = (box, key, value) => $$("button", el(box)).forEach(b => b.setAttribute("aria-pressed", b.dataset[key] === value));
    press("f-kind", "kind", draft.kind); press("f-dir", "dir", draft.dir); press("f-mode", "mode", draft.mode); press("f-payer", "payer", draft.payer);
    el("sec-quick").hidden = !!existing || !isExp; el("sec-regulars").hidden = !isExp || !usual.length; el("sec-dir").hidden = !isPeople; el("sec-cats").hidden = isPeople;
    el("sec-mode").hidden = !isExp; el("sec-split").hidden = !isExp;
    el("split-body").hidden = !draft.splitOn; el("split-me").hidden = draft.payer !== "me"; el("split-friend").hidden = draft.payer !== "friend";
    el("amount-label").textContent = isExp && draft.splitOn ? (draft.payer === "me" ? "Full bill you paid" : "Your share of the bill") : "Amount";
    el("f-cats").innerHTML = cats.map(c => `<button type="button" class="chip" data-cat="${esc(c.id)}" aria-pressed="${c.id === draft.category}">${esc(c.icon)} ${esc(c.name)}</button>`).join("");
    sumUp();
  };
  /* sumUp(): live maths for a bill you paid. Your share = bill minus friends' shares. */
  const sumUp = () => {
    const bill = num(el("f-amount").value), theirs = round2(readRows().reduce((t, o) => t + o.amount, 0)), mine = round2(bill - theirs), box = el("split-sum");
    box.classList.toggle("bad", mine < 0);
    box.textContent = mine < 0 ? `Friends' shares add up to ${inr(theirs)}, which is more than the ${inr(bill)} bill.`
      : `Your share: ${inr(mine)}. This is what counts as your spending. Friends owe you ${inr(theirs)}.`;
  };

  sheet.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.usual) { const g = usual[b.dataset.usual]; el("f-quick").value = ""; el("f-amount").value = g.amount; el("f-note").value = g.note; draft.category = g.category; draft.mode = g.mode || draft.mode; }
    else if (b.dataset.kind) draft.kind = b.dataset.kind;
    else if (b.dataset.cat) draft.category = b.dataset.cat;
    else if (b.dataset.mode) draft.mode = b.dataset.mode;
    else if (b.dataset.dir) draft.dir = b.dataset.dir;
    else if (b.dataset.payer) draft.payer = b.dataset.payer;
    else if (b.dataset.day) el("f-date").value = dateKey(addDays(new Date(), Number(b.dataset.day)));
    else if ("rm" in b.dataset) b.closest(".split-row").remove();
    else if (b.id === "split-add") addRow();
    else if (b.id === "split-equal") {
      const rows = $$(".split-row", sheet), each = Math.floor(num(el("f-amount").value) / (rows.length + 1) * 100) / 100;
      rows.forEach(r => { $(".sp-amt", r).value = each; });
    }
    else if (b.id === "f-delete") return removeEntry(existing);
    else return;
    sync();
  });
  sheet.addEventListener("input", e => {
    if (e.target.id === "f-split") { draft.splitOn = e.target.checked; if (draft.splitOn && !$$(".split-row", sheet).length) addRow(); return sync(); }
    if (e.target.id === "f-quick") {
      const p = parseQuick(e.target.value, state.records);
      el("f-amount").value = p.amount ?? ""; el("f-note").value = p.note; if (p.date) el("f-date").value = p.date;
      if (p.category) draft.category = p.category;
      return sync();
    }
    sumUp();
  });

  el("entry").addEventListener("submit", e => {
    e.preventDefault();
    const fail = message => { el("f-error").textContent = message; };
    const amount = num(el("f-amount").value), note = el("f-note").value, date = el("f-date").value || todayKey();
    if (!(amount > 0)) return fail("Enter an amount above zero.");
    let fields;
    if (draft.kind === "people") {
      if (!el("f-person").value.trim()) return fail("Add the person's name.");
      fields = { kind: draft.dir, amount, person: el("f-person").value, note };
    } else {
      fields = { kind: "expense", amount, category: draft.category, note, mode: draft.mode };
      if (draft.splitOn && draft.payer === "me") {
        const others = readRows(), theirs = round2(others.reduce((t, o) => t + o.amount, 0));
        if (!others.length) return fail("Add at least one friend, or untick the shared bill.");
        if (others.some(o => !o.name || !(o.amount > 0))) return fail("Each friend needs a name and a share above zero.");
        if (theirs > amount) return fail(`Friends' shares (${inr(theirs)}) are more than the bill (${inr(amount)}).`);
        fields.amount = round2(amount - theirs);                       // only your share is your spending
        fields.split = { paidBy: "me", total: amount, others };
      } else if (draft.splitOn) {
        if (!el("f-payer-name").value.trim()) return fail("Add the name of the friend who paid.");
        fields.split = { paidBy: el("f-payer-name").value, total: null, others: [] };
      }
    }
    const rec = makeRecord({ ...fields, date, id: existing?.id, createdAt: existing?.createdAt, auto: existing?.auto });
    closeSheet();
    save([rec], `Saved ${inr(rec.amount)}${rec.kind === "expense" ? " · " + catOf(rec.category, s).name : ""}`);
  });

  sync();
  if (!existing) (draft.kind === "expense" && !preset.kind ? el("f-quick") : el("f-amount")).focus();
}

async function removeEntry(rec) {
  closeSheet();
  toast("Entry deleted", { label: "Undo", run: () => save([makeRecord(rec)], "Entry restored") });
  try { await store.removeRecord(rec); } catch (e) { toast("Could not delete. Try again."); }
}

function openPerson(key) {
  const v = current(), p = balances(v.records, v.settings).find(x => x.key === key); if (!p) return;
  const line = p.net > 0 ? `${esc(p.name)} owes you ${inr(p.net)}` : p.net < 0 ? `You owe ${esc(p.name)} ${inr(-p.net)}` : "All settled";
  const sheet = openSheet(`<div class="sheet-head"><h2>${esc(p.name)}</h2>${CLOSE}</div>
    <p class="total ${p.net > 0 ? "plus" : p.net < 0 ? "minus" : ""}" style="font-size:26px;letter-spacing:-.01em">${line}</p>
    <div class="actions">${p.net ? `<button class="btn primary grow" id="p-settle">Settle up</button>` : ""}<button class="btn grow" id="p-gave">I gave money</button><button class="btn grow" id="p-got">I got money</button></div>
    <ul class="ledger">${p.entries.map(e => `<li><span><b>${esc(e.text)}</b><small>${dayLabel(e.record.date)}</small></span><span class="${e.delta > 0 ? "plus" : "minus"}">${e.delta > 0 ? "+" : "−"}${inr(Math.abs(e.delta))}</span></li>`).join("")}</ul>
    <p class="hint">Plus means they owe you more. Minus means you owe them more.</p>`);
  const start = preset => { if (v.demo) return toast("That is an example person. Add your own entries with +."); openEntry(null, { person: p.name, ...preset }); };
  if (p.net) $("#p-settle", sheet).onclick = () => start({ kind: p.net > 0 ? "got" : "gave", amount: Math.abs(p.net), note: "Settled up" });
  $("#p-gave", sheet).onclick = () => start({ kind: "gave" });
  $("#p-got", sheet).onclick = () => start({ kind: "got" });
}

/* The form for a recurring payment. "rule" is the one being edited, or null for a new one. */
function openRecurring(rule = null) {
  const s = state.settings, today = todayKey();
  const draft = { category: rule?.category || "bills", mode: rule?.mode || s.defaultMode, every: rule?.every || 1 };
  const sheet = openSheet(`<div class="sheet-head"><h2>${rule ? "Edit recurring payment" : "New recurring payment"}</h2>${CLOSE}</div>
    <form id="recur" novalidate autocomplete="off">
      <div class="field"><label for="r-name">What is it?</label><input id="r-name" placeholder="Spotify, mobile recharge, rent"></div>
      <div class="field"><label for="r-amount">Amount each time</label><div class="money big"><span>₹</span><input id="r-amount" inputmode="decimal" placeholder="0"></div></div>
      <div class="field"><span class="label">Category</span><div class="chips" id="r-cats"></div></div>
      <div class="field"><span class="label">How often</span><div class="seg wide" id="r-every">${REPEATS.map(x => `<button type="button" data-every="${x.every}">${x.name.replace("Every ", "")}</button>`).join("")}</div></div>
      <div class="field"><label for="r-next">Next payment date</label><input type="date" id="r-next">
        <p class="hint">Hisaab adds the entry on this date, then moves on to the same day of the next period. If this one is already paid and you want it counted, pick that past date.</p></div>
      <div class="field"><span class="label">Paid with</span><div class="seg" id="r-mode">${MODES.map(m => `<button type="button" data-mode="${m.id}">${m.name}</button>`).join("")}</div></div>
      ${rule ? `<label class="check"><input type="checkbox" id="r-paused"><span>Paused. Keep it, but stop adding entries.</span></label>` : ""}
      <p class="form-error" id="r-error" role="alert"></p>
      <div class="actions">${rule ? `<button type="button" class="btn danger" id="r-delete">Delete</button>` : ""}<button type="submit" class="btn primary grow">${rule ? "Save changes" : "Add recurring payment"}</button></div>
    </form>`);
  const el = id => $("#" + id, sheet);
  el("r-name").value = rule?.name || ""; el("r-amount").value = rule?.amount || ""; el("r-next").value = rule?.next || today;
  if (rule) el("r-paused").checked = !!rule.paused;

  const sync = () => {
    el("r-cats").innerHTML = expenseCats(s).map(c => `<button type="button" class="chip" data-cat="${esc(c.id)}" aria-pressed="${c.id === draft.category}">${esc(c.icon)} ${esc(c.name)}</button>`).join("");
    $$("button", el("r-every")).forEach(b => b.setAttribute("aria-pressed", Number(b.dataset.every) === draft.every));
    $$("button", el("r-mode")).forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === draft.mode));
  };
  /* Save the new list of rules, then let postRecurring add anything already due. */
  const saveRules = async (rules, message) => { closeSheet(); toast(message); await saveSettings({ ...s, recurring: rules }); postRecurring(); };

  sheet.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.cat) draft.category = b.dataset.cat;
    else if (b.dataset.every) draft.every = Number(b.dataset.every);
    else if (b.dataset.mode) draft.mode = b.dataset.mode;
    else if (b.id === "r-delete") return saveRules(s.recurring.filter(x => x.id !== rule.id), "Recurring payment removed. Entries it already added stay.");
    else return;
    sync();
  });
  el("recur").addEventListener("submit", e => {
    e.preventDefault();
    const fail = message => { el("r-error").textContent = message; };
    const name = el("r-name").value.trim(), amount = num(el("r-amount").value), next = el("r-next").value;
    if (!name) return fail("Give it a name.");
    if (!(amount > 0)) return fail("Enter an amount above zero.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return fail("Pick the next payment date.");
    if (daysBetween(next, today) > 366) return fail("That date is more than a year back. Pick a closer one.");
    const day = rule && next === rule.next ? rule.day : Number(next.slice(8));        // keep "the 31st" even when a short month showed the 28th
    const saved = { id: rule?.id || "r_" + uid(), name, amount, category: draft.category, mode: draft.mode, every: draft.every, day, next, paused: rule ? el("r-paused").checked : false };
    saveRules(rule ? s.recurring.map(x => x.id === rule.id ? saved : x) : [...s.recurring, saved], rule ? "Recurring payment updated" : `Added. Next payment: ${dayLabel(next)}`);
  });

  sync();
  if (!rule) el("r-name").focus();
}

function openLimit(catId) {
  const s = state.settings, cat = catId ? catOf(catId, s) : null, now = catId ? s.budgets.cats[catId] : s.budgets.total;
  const sheet = openSheet(`<div class="sheet-head"><h2>${cat ? esc(cat.name) + " limit" : "Monthly budget"}</h2>${CLOSE}</div>
    <form id="limit" novalidate><div class="field"><label for="l-amount">${cat ? "The most you want to spend on this in a month" : "The most you want to spend in a month, across everything"}</label>
      <div class="money big"><span>₹</span><input id="l-amount" inputmode="decimal" placeholder="0" value="${now || ""}"></div></div>
      <div class="actions">${now ? `<button type="button" class="btn" id="l-clear">Remove</button>` : ""}<button class="btn primary grow">Save</button></div></form>`);
  const apply = value => {
    const cats = { ...s.budgets.cats };
    if (catId) { value ? cats[catId] = value : delete cats[catId]; }
    closeSheet(); saveSettings({ ...s, budgets: { total: catId ? s.budgets.total : value, cats } });
  };
  $("#limit", sheet).addEventListener("submit", e => { e.preventDefault(); apply(num($("#l-amount", sheet).value)); });
  if (now) $("#l-clear", sheet).onclick = () => apply(0);
  $("#l-amount", sheet).focus();
}

function openCategory() {
  const s = state.settings;
  const sheet = openSheet(`<div class="sheet-head"><h2>New category</h2>${CLOSE}</div>
    <form id="cat" novalidate><div class="field"><label for="c-name">Name</label><input id="c-name" placeholder="Trips"></div>
      <div class="field"><label for="c-icon">Emoji</label><input id="c-icon" placeholder="🧳" maxlength="4"></div>
      <p class="form-error" id="c-error" role="alert"></p><div class="actions"><button class="btn primary grow">Add category</button></div></form>`);
  $("#cat", sheet).addEventListener("submit", e => {
    e.preventDefault();
    const name = $("#c-name", sheet).value.trim(), icon = $("#c-icon", sheet).value.trim() || "🏷️";
    if (!name) { $("#c-error", sheet).textContent = "Give the category a name."; return; }
    closeSheet(); saveSettings({ ...s, customCats: [...(s.customCats || []), { id: "c_" + uid(), name, icon }] });
  });
  $("#c-name", sheet).focus();
}

/* =====================================================================
   7. EXPORT AND RESTORE  -  your data is never locked in.
   ===================================================================== */
function toCsv(records, s) {
  const cell = x => { let t = String(x ?? ""); if (/^[=+\-@]/.test(t)) t = "'" + t;   // stop a spreadsheet reading a note as a formula
    return `"${t.replace(/"/g, '""')}"`; };
  const head = ["Date", "Type", "Amount (your share)", "Category", "Note", "Paid with", "Person", "Bill paid by", "Bill total", "Split with", "Added automatically"];
  const rows = records.map(r => [r.date, r.kind, r.amount, r.category ? catOf(r.category, s).name : "", r.note, modeName(r.mode), r.person,
    r.split ? (r.split.paidBy === "me" ? "Me" : r.split.paidBy) : "", r.split?.total ?? "", (r.split?.others || []).map(o => `${o.name} ${o.amount}`).join("; "), r.auto ? "yes" : ""]);
  return [head, ...rows].map(row => row.map(cell).join(",")).join("\r\n");
}

/* Hand a file to the browser's normal download. Returns true when it went through. */
function saveFile(filename, text, type) {
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = filename; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`Downloaded ${filename}`);
    return true;
  } catch (e) { copySheet(filename, text); return false; }
}
/* Fallback for the rare browser that refuses downloads: show the text to copy. */
function copySheet(filename, text) {
  const sheet = openSheet(`<div class="sheet-head"><h2>${esc(filename)}</h2>${CLOSE}</div><p class="hint">This browser would not download the file. Copy the text and paste it into a file with that name.</p>
    <textarea id="copy-text" readonly aria-label="File contents"></textarea><div class="actions"><button class="btn primary grow" id="copy-go">Copy</button></div>`);
  $("#copy-text", sheet).value = text;
  $("#copy-go", sheet).onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast("Copied"); } catch (e) { $("#copy-text", sheet).select(); toast("Select all, then copy"); }
  };
}
const backupText = settings => JSON.stringify({ app: "hisaab", version: 1, exportedAt: new Date().toISOString(), settings, records: state.records }, null, 1);

/* Read a backup file. Entries are merged in by id, so restoring twice does not duplicate.
   Budgets, categories and recurring payments are only taken onto a fresh setup, never over yours. */
async function restore(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { return toast("That file is not a Hisaab backup."); }
  if (data?.app !== "hisaab" || !Array.isArray(data.records)) return toast("That file is not a Hisaab backup.");
  const good = data.records.filter(r => r && ["expense", "gave", "got"].includes(r.kind) && (r.kind === "expense" || r.person) && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.amount >= 0).map(r => makeRecord(r));
  const fresh = !hasBudget(state.settings) && !state.settings.customCats.length && !state.settings.recurring.length;
  await save(good, `Restored ${entries(good.length)}`);
  if (data.settings && fresh) await saveSettings(cleanSettings(data.settings));
  postRecurring();
}

/* =====================================================================
   8. WIRING  -  one click listener for the whole page.
   Any element with data-act="name" runs actions.name when tapped.
   ===================================================================== */
function showTab(tab) { ui.tab = TABS.includes(tab) ? tab : "overview"; ui.shown = 80; render(); $("#view").scrollTop = 0; }
const tabInAddress = () => location.hash.slice(1) || "overview";
/* Changing tab also changes the #name in the address, so the phone's Back button returns to the previous tab. */
function goTab(tab) {
  showTab(tab);
  try { if (tabInAddress() !== ui.tab) location.hash = ui.tab; } catch (e) { /* the address is optional */ }
}
function pickBar(col) {
  const chart = col.closest(".chart"), i = col.dataset.i;
  $$(".col", chart).forEach(c => c.classList.toggle("is-picked", c === col));
  $$(".ticks span", chart).forEach((t, n) => t.classList.toggle("is-picked", String(n) === i));
  $("[data-readout-value]", chart).textContent = col.dataset.value;
  $("[data-readout-label]", chart).textContent = col.dataset.label;
}
const blankFilter = () => ({ kind: "all", cat: null, q: "", range: null });

const actions = {
  go: el => goTab(el.dataset.tab),
  add: () => openEntry(),
  "add-people": () => openEntry(null, { kind: "gave" }),
  "close-sheet": closeSheet,
  period: el => { ui.period = el.dataset.mode; ui.offset = 0; render(); },
  step: el => { ui.offset = Math.min(0, ui.offset + Number(el.dataset.d)); render(); },
  bstep: el => { ui.budgetOffset = Math.min(0, ui.budgetOffset + Number(el.dataset.d)); render(); },
  "pick-bar": pickBar,
  "pick-period": el => { ui.offset = Number(el.dataset.jump); render(); },
  "filter-cat": el => { ui.filter = { ...blankFilter(), kind: "spent", cat: el.dataset.cat, range: getRange(ui.period, ui.offset, state.settings.weekStart) }; goTab("history"); },
  "filter-kind": el => { ui.filter.kind = el.dataset.kind; render(); },
  "clear-filter": el => { ui.filter[el.dataset.key] = null; render(); },
  more: () => { ui.shown += 80; render(); },
  edit: el => {
    const rec = state.records.find(r => r.id === el.dataset.id);
    rec ? openEntry(rec) : toast("That is an example entry. Add your own with +.");
  },
  person: el => openPerson(el.dataset.key),
  limit: el => openLimit(el.dataset.cat || null),
  "new-cat": openCategory,
  "del-cat": el => { const s = state.settings, c = catOf(el.dataset.cat, s);
    confirmSheet(`Remove ${c.name}?`, "Entries in this category stay in your ledger and show under Other.", "Remove", () => {
      const cats = { ...s.budgets.cats }; delete cats[c.id];
      saveSettings({ ...s, customCats: s.customCats.filter(x => x.id !== c.id), budgets: { ...s.budgets, cats } }); }); },
  pref: el => saveSettings({ ...state.settings, [el.dataset.key]: el.dataset.key === "weekStart" ? Number(el.dataset.value) : el.dataset.value }),
  "export-csv": () => saveFile(`hisaab-${todayKey()}.csv`, "﻿" + toCsv(state.records, state.settings), "text/csv"),
  "export-json": () => { const s = { ...state.settings, lastBackup: todayKey() };
    if (saveFile(`hisaab-backup-${todayKey()}.json`, backupText(s), "application/json")) saveSettings(s); },
  restore: () => $("#restore-file").click(),
  wipe: () => confirmSheet("Delete everything?", "Every entry, budget, recurring payment and custom category will be removed. This cannot be undone.", "Delete everything", async () => {
    try { await store.wipe(); toast("Ledger cleared"); } catch (e) { toast("Could not delete. Try again."); } }),
  recur: el => {
    if (!el.dataset.id) return openRecurring();
    const rule = state.settings.recurring.find(r => r.id === el.dataset.id);
    rule ? openRecurring(rule) : toast("That is an example. Add your own with Add one.");
  },
  "quiet-today": () => { const s = state.settings, t = todayKey(), on = s.quietDays.includes(t);
    saveSettings({ ...s, quietDays: on ? s.quietDays.filter(d => d !== t) : [...s.quietDays.slice(-400), t] }); },
  reload: () => location.reload(),
  install: async () => { const ask = shell.installEvent; if (!ask) return; shell.installEvent = null; ask.prompt(); await ask.userChoice; render(); },
};

document.addEventListener("click", e => { const el = e.target.closest("[data-act]"); if (el && !el.disabled && actions[el.dataset.act]) actions[el.dataset.act](el); });
document.addEventListener("pointerover", e => { const col = e.pointerType === "mouse" && e.target.closest(".col"); if (col) pickBar(col); });
document.addEventListener("focusin", e => { const col = e.target.closest(".col"); if (col) pickBar(col); });
document.addEventListener("input", e => { if (e.target.id === "h-search") { ui.filter.q = e.target.value; ui.shown = 80; $("#history-list").innerHTML = historyList(current()); } });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
$("#restore-file").addEventListener("change", e => { const file = e.target.files[0]; e.target.value = ""; if (file) restore(file); });
window.addEventListener("hashchange", () => { const tab = tabInAddress(); if (TABS.includes(tab) && tab !== ui.tab) showTab(tab); });
window.addEventListener("popstate", () => { if (!history.state?.sheet) $("#sheet-root").innerHTML = ""; });   // Back was pressed while a sheet was open

/* =====================================================================
   9. APP SHELL  -  what makes the website behave like an installed app.
   ===================================================================== */
const shell = { installEvent: null, installed: window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true };

function startAppShell() {
  // 1. Offline: sw.js keeps a copy of the app's files, so it opens with no internet.
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  // 2. Install button: Chrome and Edge announce when the app can be installed.
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); shell.installEvent = e; if (ui.tab === "setup") render(); });
  window.addEventListener("appinstalled", () => { shell.installed = true; shell.installEvent = null; render(); });
  // 3. Ask the browser not to clear our storage when the device runs low on space.
  if (navigator.storage?.persisted) navigator.storage.persisted().then(async kept => {
    if (!kept && state.records.length && navigator.storage.persist) kept = await navigator.storage.persist();
    state.persisted = kept; if (ui.tab === "setup") render();
  }).catch(() => {});
  // 4. Coming back to the app on a new day: add what fell due and redraw "today".
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.ready) { postRecurring(); if (!$("#sheet-root").firstChild) render(); } });
}

if (TABS.includes(location.hash.slice(1))) ui.tab = location.hash.slice(1);
boot();
