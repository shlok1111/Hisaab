/* End-to-end checks for Hisaab. They drive a real browser through the app.
   You do not need this file to use the app. It is here so a change can be verified.

   Run:   npm install playwright        (once)
          node tests/run.js [folder-for-screenshots]
   Set CHROME=/path/to/chrome to use an installed browser instead of Playwright's own. */
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + extra}`); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png") }); };

/* A tiny web server for the project folder, so the service worker can run (it needs http, not file://). */
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
function serve() {
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (file.endsWith("/")) file += "index.html";
    const full = path.join(ROOT, file);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(full)] || "application/octet-stream" });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"] });
  const open = async (options = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, ...options });
    const page = await ctx.newPage(); const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(url); await wait(300);
    return { ctx, page, errors };
  };

  // ============================================================ A. pure logic
  {
    const { ctx, page, errors } = await open();
    const t = await page.evaluate(() => {
      const out = {};
      const wk = getRange("week", 0, 1), mo = getRange("month", 0, 1), now = new Date();
      out.week = wk.days.length === 7 && wk.start.getDay() === 1 && wk.days.includes(todayKey());
      out.weekSun = getRange("week", 0, 0).start.getDay() === 0;
      out.prevWeek = getRange("week", -1, 1).to < wk.from && getRange("week", -1, 1).days.length === 7;
      out.month = mo.days.length === new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() && mo.from.endsWith("-01");
      out.round = round2(0.1 + 0.2) === 0.3 && round2(1.005) === 1.01;
      out.inr = [inr(123456.5), inr(250), inr(-40)].join("|");
      out.q1 = parseQuick("250 swiggy dinner", []);
      out.q2 = parseQuick("1.5k rent yesterday", []);
      out.q3 = parseQuick("uber 1,200", []);
      out.q4 = parseQuick("random thing", []);
      const d = todayKey();
      const recs = [
        makeRecord({ kind: "expense", amount: 200, date: d, category: "food", note: "A", split: { paidBy: "me", total: 700, others: [{ name: "ravi", amount: 300 }, { name: "Sana", amount: 200 }] } }),
        makeRecord({ kind: "expense", amount: 120, date: d, category: "fun", note: "=B", split: { paidBy: "ravi", total: null, others: [] } }),
        makeRecord({ kind: "gave", amount: 500, date: d, person: "Sana" }),
        makeRecord({ kind: "got", amount: 100, date: d, person: "sana " }),
      ];
      out.bal = balances(recs, DEFAULT_SETTINGS).map(p => [p.name, p.net]);
      out.spent = sum(expensesIn(recs, wk));
      out.cats = totalsByCategory(expensesIn(recs, wk), DEFAULT_SETTINGS).map(c => [c.id, c.total]);
      const past = getRange("month", -1, 1);
      out.b1 = budgetStatus(500, 1000, past).level; out.b2 = budgetStatus(850, 1000, past).level; out.b3 = budgetStatus(1200, 1000, past).level;
      const b = budgetStatus(400, 1000, mo); out.b4 = b.left === 600 && b.daysLeft === mo.days.length - mo.days.indexOf(todayKey());
      out.learn = guessCategory("zzcustom thing", [makeRecord({ kind: "expense", amount: 1, category: "health", note: "zzcustom thing" })]);
      const csv = toCsv(recs, DEFAULT_SETTINGS); out.csv = csv.split("\r\n").length; out.csvGuard = csv.includes(`"'=B"`);

      // recurring payments
      out.due = [nextDue("2026-01-31", 1, 31), nextDue("2026-02-28", 1, 31), nextDue("2026-12-15", 1, 15), nextDue("2024-01-31", 1, 31), nextDue("2026-11-30", 3, 30), nextDue("2026-03-10", 12, 10)];
      const rule = { id: "r1", name: "Spotify", amount: 119, category: "bills", mode: "upi", every: 1, day: 5, next: "2026-08-05", paused: false };
      const run = dueRecurring([rule], "2026-11-16");
      out.catchUp = [run.records.map(r => r.date).join(), run.rules[0].next, run.records[0].id, run.records.every(r => r.auto === "r1" && r.amount === 119 && r.note === "Spotify")];
      out.notDue = dueRecurring([{ ...rule, next: "2026-11-17" }], "2026-11-16").records.length;
      out.paused = dueRecurring([{ ...rule, paused: true }], "2026-11-16").records.length;
      out.again = dueRecurring(run.rules, "2026-11-16").records.length;
      out.monthly = monthlyCost([rule, { ...rule, amount: 300, every: 3 }, { ...rule, amount: 999, paused: true }]);
      out.upcoming = upcoming([{ ...rule, next: "2026-11-20" }, { ...rule, id: "r2", next: "2026-12-25" }, { ...rule, id: "r3", next: "2026-11-18", paused: true }], "2026-11-16", 14).map(r => r.id).join();

      // streak
      const on = (date, extra = {}) => makeRecord({ kind: "expense", amount: 10, date, category: "food", note: "x", ...extra });
      out.streak = [
        streak([on("2026-11-16"), on("2026-11-15"), on("2026-11-14"), on("2026-11-12")], [], "2026-11-16"),          // 3, done
        streak([on("2026-11-15"), on("2026-11-14")], [], "2026-11-16"),                                              // 2, not yet today
        streak([on("2026-11-14")], [], "2026-11-16"),                                                                // broken
        streak([on("2026-11-14")], ["2026-11-15", "2026-11-16"], "2026-11-16"),                                      // no-spend days keep it alive
        streak([on("2026-11-16", { auto: "r1" })], [], "2026-11-16"),                                                // automatic entries do not count
      ].map(s => `${s.days}${s.doneToday ? "y" : "n"}`).join();

      // regulars
      const hist = [on("2026-11-16", { note: "Chai", amount: 25 }), on("2026-11-15", { note: "chai", amount: 20 }), on("2026-11-14", { note: "chai", amount: 20 }),
        on("2026-11-13", { note: "Auto", category: "transport", amount: 60 }), on("2026-11-12", { note: "auto", category: "transport", amount: 50 }),
        on("2026-11-11", { note: "Once" }), on("2026-05-01", { note: "Old" }), on("2026-05-02", { note: "Old" })];
      out.regulars = regulars(hist, "2026-11-16", 6).map(g => `${g.note}:${g.amount}:${g.count}`).join();

      out.backup = [backupDue(new Array(14).fill(0), { lastBackup: "" }, "2026-11-16"), backupDue(new Array(15).fill(0), { lastBackup: "" }, "2026-11-16"),
        backupDue(new Array(15).fill(0), { lastBackup: "2026-11-10" }, "2026-11-16"), backupDue(new Array(15).fill(0), { lastBackup: "2026-11-02" }, "2026-11-16")].join();
      out.gap = [daysBetween("2026-11-16", "2026-11-16"), daysBetween("2026-10-31", "2026-11-16"), daysBetween("2026-11-16", "2026-11-10")].join();
      return out;
    });
    check("week is Mon–Sun and contains today", t.week);
    check("week can start on Sunday", t.weekSun);
    check("previous week sits before this week", t.prevWeek);
    check("month has the right number of days", t.month);
    check("money rounding", t.round);
    check("rupee formatting (Indian grouping)", t.inr === "₹1,23,456.50|₹250|−₹40", t.inr);
    check("parse '250 swiggy dinner'", t.q1.amount === 250 && t.q1.category === "food" && t.q1.note === "swiggy dinner", JSON.stringify(t.q1));
    check("parse '1.5k rent yesterday'", t.q2.amount === 1500 && t.q2.category === "bills" && t.q2.note === "rent" && !!t.q2.date, JSON.stringify(t.q2));
    check("parse 'uber 1,200'", t.q3.amount === 1200 && t.q3.category === "transport", JSON.stringify(t.q3));
    check("unknown words leave category empty", t.q4.category === null && t.q4.amount === null);
    check("balances: Sana +600, Ravi +180", JSON.stringify(t.bal) === JSON.stringify([["Sana", 600], ["Ravi", 180]]), JSON.stringify(t.bal));
    check("spending counts only my shares (200 + 120)", t.spent === 320, String(t.spent));
    check("category totals", JSON.stringify(t.cats) === JSON.stringify([["food", 200], ["fun", 120]]), JSON.stringify(t.cats));
    check("budget levels ok / warn / over", t.b1 === "ok" && t.b2 === "warn" && t.b3 === "over", [t.b1, t.b2, t.b3].join());
    check("budget days-left counts today", t.b4);
    check("category learned from own history", t.learn === "health", t.learn);
    check("csv has header + 4 rows", t.csv === 5, String(t.csv));
    check("csv neutralises a note that starts with =", t.csvGuard);
    check("next due date: month ends, year ends, leap year, quarterly, yearly", t.due.join() === "2026-02-28,2026-03-31,2027-01-15,2024-02-29,2027-02-28,2027-03-10", t.due.join());
    check("recurring catches up on missed months", t.catchUp[0] === "2026-08-05,2026-09-05,2026-10-05,2026-11-05" && t.catchUp[1] === "2026-12-05" && t.catchUp[2] === "auto_r1_2026-08-05" && t.catchUp[3], JSON.stringify(t.catchUp));
    check("recurring: nothing before the due date, nothing while paused, nothing twice", t.notDue === 0 && t.paused === 0 && t.again === 0, [t.notDue, t.paused, t.again].join());
    check("recurring: monthly cost spreads quarterly payments, skips paused", t.monthly === 219, String(t.monthly));
    check("recurring: 'coming up' is the next 14 days, without paused ones", t.upcoming === "r1", t.upcoming);
    check("streak: counts, pauses for today, breaks, no-spend days, ignores automatic entries", t.streak === "3y,2n,0n,3y,0n", t.streak);
    check("regulars: grouped by note, latest amount, most frequent first, old and one-offs dropped", t.regulars === "Chai:25:3,Auto:60:2", t.regulars);
    check("backup nudge: needs 15 entries and 14 days", t.backup === "false,true,false,true", t.backup);
    check("days between dates", t.gap === "0,16,-6", t.gap);
    check("no script errors (logic page)", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ============================================================ B. the full flow on a phone-sized screen
  {
    const { ctx, page, errors } = await open();
    const recs = () => page.evaluate(() => state.records.map(r => ({ ...r })));
    const add = async fill => { await page.click(".tab.add"); await fill(); await page.click("#entry button[type=submit]"); await wait(120); };

    check("opens with example data", await page.locator("text=These are example entries").count() === 1);
    check("status says the data is on this device", (await page.textContent("#status")).includes("On this device"), await page.textContent("#status"));
    check("example recurring payments are shown", await page.locator("text=Coming up").count() === 1);
    await shot(page, "phone-1-first-open");

    // 1. one-line entry
    await add(async () => { await page.fill("#f-quick", "250 swiggy dinner"); });
    let r = await recs();
    check("quick entry saved", r.length === 1 && r[0].amount === 250 && r[0].category === "food" && r[0].note === "swiggy dinner" && r[0].auto === null, JSON.stringify(r));
    check("examples gone after first entry", await page.locator("text=These are example entries").count() === 0 && await page.locator("text=Coming up").count() === 0);
    check("hero shows ₹250", (await page.textContent(".total")).trim() === "₹250", await page.textContent(".total"));
    check("streak strip: 1 day, today logged", (await page.textContent(".streak")).includes("1day in a row") && (await page.textContent(".streak")).includes("Today is logged"), await page.textContent(".streak"));

    // 2. the add form offers Spent and Lent / borrowed, nothing else
    await page.click(".tab.add");
    check("entry kinds are Spent and Lent / borrowed", (await page.locator("#f-kind button").allTextContents()).join("|") === "Spent|Lent / borrowed");
    await page.click("[data-act=close-sheet]");

    // 3. bill I paid, split unequally: 520 total, Aarav's items 340 -> my share 180
    await add(async () => {
      await page.fill("#f-amount", "520"); await page.fill("#f-note", "Cafe"); await page.check("#f-split");
      await page.fill(".sp-name", "aarav"); await page.fill(".sp-amt", "340");
    });
    r = await recs(); const cafe = r.find(x => x.note === "Cafe");
    check("split records only my share", cafe && cafe.amount === 180 && cafe.split.total === 520 && cafe.split.others[0].name === "Aarav", JSON.stringify(cafe));
    check("total is 250 + 180", (await page.textContent(".total")).trim() === "₹430", await page.textContent(".total"));

    // 4. a friend paid; my share 150
    await add(async () => {
      await page.fill("#f-amount", "150"); await page.fill("#f-note", "Bowling"); await page.check("#f-split");
      await page.click("#f-payer [data-payer=friend]"); await page.fill("#f-payer-name", "Meera");
    });
    let bal = await page.evaluate(() => balances(state.records, state.settings).map(p => [p.name, p.net]));
    check("balances Aarav +340, Meera -150", JSON.stringify(bal) === JSON.stringify([["Aarav", 340], ["Meera", -150]]), JSON.stringify(bal));

    // 5. split validation
    await page.click(".tab.add"); await page.fill("#f-amount", "100"); await page.check("#f-split");
    await page.fill(".sp-name", "X"); await page.fill(".sp-amt", "150"); await page.click("#entry button[type=submit]");
    check("over-split refused", (await page.textContent("#f-error")).includes("more than the bill"));
    await page.click("[data-act=close-sheet]");

    // 6. a plain loan, then settle up from the People screen
    await page.click(".tab[data-tab=people]"); await page.click("[data-act=add-people]");
    await page.fill("#f-amount", "500"); await page.fill("#f-person", "rohan"); await page.fill("#f-note", "Lent for books"); await page.click("#entry button[type=submit]"); await wait(120);
    bal = await page.evaluate(() => Object.fromEntries(balances(state.records, state.settings).map(p => [p.name, p.net])));
    check("lending adds to what a friend owes", bal.Rohan === 500, JSON.stringify(bal));
    await page.click("[data-act=person][data-key=aarav]"); await page.click("#p-settle");
    check("settle form prefilled", await page.inputValue("#f-amount") === "340" && await page.inputValue("#f-person") === "Aarav");
    await page.click("#entry button[type=submit]"); await wait(120);
    bal = await page.evaluate(() => Object.fromEntries(balances(state.records, state.settings).map(p => [p.name, p.net])));
    check("Aarav settled, lending never counted as spending", bal.Aarav === 0 && await page.evaluate(() => sum(state.records.filter(x => x.kind === "expense"))) === 580, JSON.stringify(bal));
    await shot(page, "phone-5-people");

    // 7. edit: move the first entry to last month and change the amount
    await page.click(".tab[data-tab=history]");
    await page.click(".row:has-text('swiggy dinner')");
    const lastMonth = await page.evaluate(() => { const d = new Date(); return dateKey(new Date(d.getFullYear(), d.getMonth() - 1, 15)); });
    await page.fill("#f-date", lastMonth); await page.fill("#f-amount", "275"); await page.click("#entry button[type=submit]"); await wait(150);
    r = await recs(); const moved = r.filter(x => x.note === "swiggy dinner");
    check("edit changes the entry without duplicating it", moved.length === 1 && moved[0].date === lastMonth && moved[0].amount === 275, JSON.stringify(moved));

    // 8. delete and undo
    await page.click(".row:has-text('Bowling')"); await page.click("#f-delete"); await wait(120);
    check("delete removes entry", !(await recs()).some(x => x.note === "Bowling"));
    await page.click("#toast button"); await wait(150);
    check("undo restores entry", (await recs()).some(x => x.note === "Bowling" && x.split.paidBy === "Meera"));

    // 9. search
    await page.fill("#h-search", "meera"); await wait(80);
    check("search finds an entry by friend's name", await page.locator("#history-list .row").count() === 1);
    await page.fill("#h-search", ""); await wait(80);

    // 10. budgets
    await page.click(".tab[data-tab=budget]"); await page.click("text=Set a monthly budget"); await page.fill("#l-amount", "9000"); await page.click("#limit button.primary"); await wait(120);
    await page.click("[data-act=limit][data-cat=food]"); await page.fill("#l-amount", "100"); await page.click("#limit button.primary"); await wait(120);
    const st = await page.evaluate(() => state.settings.budgets);
    check("budgets saved", st.total === 9000 && st.cats.food === 100, JSON.stringify(st));
    check("food limit shows Over", await page.locator(".row[data-cat=food] .pill.over").count() === 1);

    // 11. recurring payment that started 40 days ago: the missed payments are added now, exactly once
    const expected = await page.evaluate(() => {
      const start = dateKey(addDays(new Date(), -40));
      const run = dueRecurring([{ id: "x", name: "Spotify", amount: 119, category: "bills", mode: "upi", every: 1, day: Number(start.slice(8)), next: start, paused: false }], todayKey());
      return { start, dates: run.records.map(x => x.date), next: run.rules[0].next };
    });
    await page.click("[data-act=recur]:not([data-id])");
    await page.fill("#r-name", "Spotify"); await page.fill("#r-amount", "119"); await page.fill("#r-next", expected.start);
    await page.click("#recur button[type=submit]"); await wait(200);
    r = await recs(); let autos = r.filter(x => x.auto);
    const rule = await page.evaluate(() => state.settings.recurring[0]);
    check("recurring: missed payments added", autos.length === expected.dates.length && autos.length >= 2 && autos.every(x => x.note === "Spotify" && x.amount === 119 && x.category === "bills" && x.auto === rule.id), JSON.stringify(autos.map(x => x.date)));
    check("recurring: rule moved to its next date", rule.next === expected.next && rule.next > await page.evaluate(() => todayKey()), rule.next);
    check("recurring: listed on the Budget screen", await page.locator(`.row[data-act=recur][data-id="${rule.id}"]`).count() === 1);
    await shot(page, "phone-4-budget");

    // 12. far-past start date is refused
    await page.click("[data-act=recur]:not([data-id])");
    await page.fill("#r-name", "Old"); await page.fill("#r-amount", "10"); await page.fill("#r-next", "2020-01-01"); await page.click("#recur button[type=submit]");
    check("recurring: a date over a year back is refused", (await page.textContent("#r-error")).includes("more than a year"));
    await page.click("[data-act=close-sheet]");

    // 13. pause, then delete a rule; its entries stay
    await page.click(`.row[data-act=recur][data-id="${rule.id}"]`); await page.check("#r-paused"); await page.click("#recur button[type=submit]"); await wait(150);
    check("recurring: can be paused", await page.evaluate(() => state.settings.recurring[0].paused) === true && (await page.textContent(`.row[data-act=recur][data-id="${rule.id}"]`)).includes("Paused"));
    await page.click(`.row[data-act=recur][data-id="${rule.id}"]`); await page.uncheck("#r-paused"); await page.click("#recur button[type=submit]"); await wait(150);

    // 14. regulars: log chai twice, then it is offered as a tap-to-fill button
    await add(async () => { await page.fill("#f-quick", "20 chai"); });
    await add(async () => { await page.fill("#f-quick", "20 chai"); });
    await page.click(".tab.add"); await wait(400);
    const chips = await page.locator("#f-regulars .chip").allTextContents();
    check("regulars offered in the add form", chips.length === 1 && chips[0].includes("chai") && chips[0].includes("₹20"), JSON.stringify(chips));
    check("opening a form clears the last toast", (await page.textContent("#toast")) === "");
    await shot(page, "phone-2-add-entry");
    await page.click("#f-regulars .chip"); await wait(50);
    check("tapping a regular fills the form", await page.inputValue("#f-amount") === "20" && await page.inputValue("#f-note") === "chai" && await page.getAttribute("#f-cats [data-cat=food]", "aria-pressed") === "true");
    await page.click("#entry button[type=submit]"); await wait(120);
    check("regular saved as a normal entry", (await recs()).filter(x => x.note === "chai").length === 3);

    // 15. survives a reload, and recurring entries are not added again
    const before = (await recs()).length;
    await page.reload(); await wait(400);
    r = await recs();
    check("data survives reload", r.length === before && (await page.evaluate(() => state.settings.budgets.total)) === 9000, `${r.length} vs ${before}`);
    check("recurring entries not duplicated by reopening", r.filter(x => x.auto).length === autos.length);

    // 16. backup, spreadsheet, wipe, restore
    await page.click("[data-tab=setup]"); await wait(100);
    const [csv] = await Promise.all([page.waitForEvent("download"), page.click("[data-act=export-csv]")]);
    const csvText = fs.readFileSync(await csv.path(), "utf8");
    check("spreadsheet export downloads", csv.suggestedFilename().endsWith(".csv") && csvText.split("\r\n").length === before + 1 && csvText.includes("Spotify"), csv.suggestedFilename());
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-act=export-json]")]);
    const backupPath = path.join(require("os").tmpdir(), `hisaab-test-backup-${Date.now()}.json`);
    await dl.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
    check("backup file holds every entry and the settings", backup.app === "hisaab" && backup.records.length === before && backup.settings.recurring.length === 1 && backup.settings.budgets.total === 9000);
    await wait(100);
    check("backup date remembered", await page.evaluate(() => state.settings.lastBackup === todayKey()));
    await shot(page, "phone-6-setup");

    await page.click("[data-act=wipe]"); await page.click("#confirm-yes"); await wait(200);
    check("delete everything empties the ledger", (await recs()).length === 0 && await page.evaluate(() => state.settings.recurring.length === 0 && localStorage.getItem(LOCAL_KEY).length < 200));
    await page.setInputFiles("#restore-file", backupPath); await wait(400);
    r = await recs();
    check("restore brings back every entry", r.length === before, `${r.length} vs ${before}`);
    check("restore brings back budgets and recurring payments on a fresh setup", await page.evaluate(() => state.settings.budgets.total === 9000 && state.settings.recurring.length === 1));
    await page.setInputFiles("#restore-file", backupPath); await wait(400);
    check("restoring twice does not duplicate", (await recs()).length === before);
    fs.writeFileSync(backupPath, "not json"); await page.setInputFiles("#restore-file", backupPath); await wait(200);
    check("a wrong file is refused", (await page.textContent("#toast")).includes("not a Hisaab backup") && (await recs()).length === before);
    fs.unlinkSync(backupPath);

    // 17. installable: manifest, icons, service worker, then offline
    const manifest = await page.evaluate(async () => { const m = await (await fetch(document.querySelector("link[rel=manifest]").href)).json(); const icons = await Promise.all(m.icons.map(async i => (await fetch(i.src)).ok)); return { m, icons }; });
    check("manifest is valid and its icons exist", manifest.m.display === "standalone" && manifest.m.start_url === "./" && manifest.icons.length === 3 && manifest.icons.every(Boolean));
    const swFiles = await page.evaluate(async () => { await navigator.serviceWorker.ready; const c = await caches.open("hisaab-files-v1"); return (await c.keys()).length; });
    check("service worker saved the app's files", swFiles >= 18, String(swFiles));
    const listed = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").match(/"(?:\.\/|[\w./-]+\.\w+)"/g).map(s => s.slice(1, -1)).filter(f => f !== "./");
    check("every file the service worker lists exists", listed.length >= 17 && listed.every(f => fs.existsSync(path.join(ROOT, f))), listed.filter(f => !fs.existsSync(path.join(ROOT, f))).join());
    await page.reload(); await wait(300);                                   // make sure this page is under the service worker's control
    await ctx.setOffline(true);
    await page.reload(); await wait(500);
    check("opens with no internet, data intact", (await page.textContent(".brand b")) === "Hisaab" && (await recs()).length === before && await page.evaluate(() => getComputedStyle(document.body).display === "flex"));
    await add(async () => { await page.fill("#f-quick", "60 auto offline"); });
    check("can add an entry while offline", (await recs()).length === before + 1);
    await ctx.setOffline(false);

    check("fonts are served by the app itself", await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(f => f.status === "loaded").length >= 3 && performance.getEntriesByType("resource").every(e => new URL(e.name).origin === location.origin); }));
    check("no script errors (phone flow)", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ============================================================ C. streak and the no-spend button
  {
    const { ctx, page, errors } = await open();
    await page.click(".tab.add"); await page.fill("#f-quick", "90 lunch"); await page.click("#entry .chip[data-day='-1']"); await page.click("#entry button[type=submit]"); await wait(120);
    let strip = await page.textContent(".streak");
    check("streak: yesterday logged, today pending", strip.includes("1day in a row") && strip.includes("Nothing logged today yet"), strip);
    await page.click("[data-act=quiet-today]"); await wait(100);
    strip = await page.textContent(".streak");
    check("streak: no-spend day counts", strip.includes("2days in a row") && strip.includes("no-spend day"), strip);
    await page.click("[data-act=quiet-today]"); await wait(100);
    check("streak: no-spend can be undone", (await page.textContent(".streak")).includes("1day in a row"));
    check("no script errors (streak)", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ============================================================ D. a well-used ledger, for the backup nudge and screenshots
  const seed = () => {
    const list = demoRecords().filter(r => !r.split).map((r, i) => makeRecord({ ...r, id: "seed" + i, createdAt: "seed" + i }));
    list.push(makeRecord({ kind: "expense", amount: 180, category: "food", note: "Cafe with Aarav", mode: "upi", split: { paidBy: "me", total: 520, others: [{ name: "Aarav", amount: 340 }] } }));
    list.push(makeRecord({ kind: "gave", amount: 500, person: "Rohan", note: "Lent for books" }));
    list.push(makeRecord({ kind: "expense", amount: 150, category: "fun", note: "Bowling", split: { paidBy: "Meera", total: null, others: [] } }));
    const soon = n => addDays(new Date(), n);
    const rule = (id, name, amount, every, n) => ({ id, name, amount, category: "bills", mode: "upi", every, day: soon(n).getDate(), next: dateKey(soon(n)), paused: false });
    store.putRecords(list);
    store.putSettings({ ...state.settings, budgets: { total: 9000, cats: { food: 4000, fun: 1500, transport: 1200 } }, recurring: [rule("r1", "Spotify", 119, 1, 3), rule("r2", "Mobile recharge", 299, 3, 11), rule("r3", "Gym", 800, 1, 24)] });
    return list.length;
  };
  {
    const { ctx, page, errors } = await open();
    const count = await page.evaluate(seed); await wait(200);
    check("backup nudge appears on a used ledger with no backup", count > 100 && await page.locator("text=Time for a backup").count() === 1);
    await page.click("[data-act=period][data-mode=month]"); await wait(100);
    await shot(page, "phone-3-overview-month");
    const hero = await page.evaluate(() => ({ total: document.querySelector(".total").textContent.trim(), want: inr(sum(expensesIn(state.records, getRange("month", 0, 1)))) }));
    check("month total on screen equals the sum of this month's entries", hero.total === hero.want, `${hero.total} vs ${hero.want}`);
    check("coming up lists the payments due in 14 days", await page.locator("section:has-text('Coming up') .row").count() === 2);
    await page.click(".tab[data-tab=history]"); await wait(100); await shot(page, "phone-7-history");
    check("backup nudge stays on the Overview only", await page.locator("text=Time for a backup").count() === 0);
    await page.click(".tab[data-tab=overview]"); await wait(100);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".banner [data-act=export-json]")]);
    const nudged = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    await wait(150);
    check("backup nudge goes away after a backup, and the file carries its own date", await page.locator("text=Time for a backup").count() === 0 && nudged.settings.lastBackup === await page.evaluate(() => todayKey()));

    // the phone's Back button: closes an open form first, then steps back through tabs
    await page.click(".tab[data-tab=budget]"); await wait(80);
    await page.click(".tab.add"); await wait(80);
    await page.goBack(); await wait(150);
    check("Back closes an open form and stays on the same tab", await page.locator("#entry").count() === 0 && await page.evaluate(() => ui.tab) === "budget");
    await page.click(".tab.add"); await wait(80); await page.click("[data-act=close-sheet]"); await wait(150);
    check("closing a form by hand leaves the tab alone", await page.evaluate(() => ui.tab) === "budget" && page.url().endsWith("#budget"));
    await page.goBack(); await wait(150);
    check("Back returns to the previous tab", await page.evaluate(() => ui.tab) === "overview", await page.evaluate(() => ui.tab));
    await page.goBack(); await wait(150);
    check("Back again reaches History, the tab before that", await page.evaluate(() => ui.tab) === "history", await page.evaluate(() => ui.tab));

    // colour preference
    await page.click("[data-tab=setup]"); await wait(80); await page.click("[data-act=pref][data-key=theme][data-value=dark]"); await wait(100);
    check("dark colours can be forced", await page.evaluate(() => document.documentElement.dataset.theme === "dark" && getComputedStyle(document.body).backgroundColor === "rgb(11, 15, 13)"));
    await page.reload(); await wait(300);
    check("colour choice survives a reload", await page.evaluate(() => document.documentElement.dataset.theme === "dark"));
    check("no script errors (used ledger, phone)", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  for (const scheme of ["light", "dark"]) {
    const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme });
    await page.evaluate(seed); await wait(200);
    await page.click("[data-act=period][data-mode=month]"); await wait(100);
    await shot(page, `laptop-${scheme}-overview`);
    await page.click(".tab[data-tab=budget]"); await wait(100); await shot(page, `laptop-${scheme}-budget`);
    check(`no script errors (laptop ${scheme})`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ============================================================ E. the app-icon shortcut and blocked storage
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage(); await page.goto(url + "#add"); await wait(300);
    check("the #add shortcut opens the add form", await page.locator("#entry").count() === 1 && !page.url().includes("#add"));
    await ctx.close();
    // damaged storage: the app must still open, keep the good entry and ignore the rest
    const bad = await open();
    await bad.page.evaluate(() => localStorage.setItem(LOCAL_KEY, JSON.stringify({
      records: { a: makeRecord({ id: "a", kind: "expense", amount: 70, category: "nope", note: "Good one" }), b: null, c: { id: "c" } },
      settings: { budgets: null, recurring: "oops", customCats: [null, { id: "c_1", name: "Trips", icon: "🧳" }], quietDays: 7, theme: "pink",
        extra: 1 } })));
    await bad.page.reload(); await wait(300);
    check("damaged storage: opens, keeps the good entry, drops the rest", await bad.page.evaluate(() => state.records.length === 1 && state.settings.recurring.length === 0 && state.settings.customCats.length === 1 && state.settings.theme === "auto" && state.settings.budgets.total === 0)
      && (await bad.page.textContent(".total")).trim() === "₹70");
    for (const tab of ["history", "budget", "people", "setup"]) { await bad.page.click(`[data-tab=${tab}]`); await wait(60); }
    check("damaged storage: every screen still draws", bad.errors.length === 0 && await bad.page.locator("text=could not be drawn").count() === 0, bad.errors.join(" | "));

    // a screen that throws shows a message and a way to save the data, not a blank page
    await bad.page.evaluate(() => { VIEWS.history = () => { throw new Error("boom"); }; });
    await bad.page.click("[data-tab=history]"); await wait(80);
    check("a broken screen explains itself", (await bad.page.textContent("#view")).includes("could not be drawn") && (await bad.page.textContent("#view")).includes("boom"));
    const [rescue] = await Promise.all([bad.page.waitForEvent("download"), bad.page.click("#view [data-act=export-json]")]);
    check("a broken screen still lets you download a backup", rescue.suggestedFilename().endsWith(".json") && JSON.parse(fs.readFileSync(await rescue.path(), "utf8")).records.length === 1);
    await bad.page.click("[data-tab=overview]"); await wait(80);
    check("other screens keep working after one fails", (await bad.page.textContent(".total")).trim() === "₹70");
    await bad.ctx.close();

    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx2.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
    const page2 = await ctx2.newPage(); await page2.goto(url); await wait(300);
    check("blocked storage is reported, not hidden", (await page2.textContent("#status")).includes("Not saving") && await page2.locator("text=Nothing is being saved").count() === 1);
    await ctx2.close();
  }

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
