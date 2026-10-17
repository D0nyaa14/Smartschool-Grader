"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const core = require("../guest-site/assets/app.js");
const header = "year,subject,title,earned,possible,weight,date\n";
const row = "2026-2027,Mathematics,Quiz,16,20,1,2026-10-01";
const sample = {year: "2026-2027", subject: "Mathematics", title: "Quiz", earned: 16, possible: 20, weight: 1, date: "2026-10-01"};

test("weighted average converts points before applying relative weights", () => {
  assert.equal(core.weightedAverage([{earned: 10, possible: 10, weight: 1}, {earned: 50, possible: 100, weight: 3}]), 62.5);
  assert.equal(core.weightedAverage([]), null);
  assert.equal(core.weightedAverage([{earned: 0, possible: 10, weight: 1}]), 0);
});
test("future projection and target average use future weights", () => {
  const current = [{earned: 16, possible: 20, weight: 1}];
  const future = [{earned: 18, possible: 20, weight: 1}];
  assert.deepEqual(core.simulate(current, future, 85), {projected: 85, needed: 90, target: 85, status: "achievable"});
  assert.equal(core.simulate([{earned: 10, possible: 10, weight: 10}], future, 50).status, "already");
  assert.equal(core.simulate([{earned: 0, possible: 10, weight: 9}], future, 60).status, "impossible");
  assert.equal(core.simulate([], future, 90).projected, 90);
  assert.throws(() => core.simulate(current, [], 85));
  assert.throws(() => core.simulate(current, [...future, ...future, ...future, ...future], 85));
  assert.throws(() => core.simulate(current, future, Infinity));
});
test("CSV handles BOM, CRLF, commas, doubled quotes, and quoted newlines", () => {
  const records = core.parseImport('\uFEFF' + header.replace(/\n/g, '\r\n') + '2026-2027,"Science, lab","A ""quoted""\nreport",8,10,2,2026-10-01\r\n');
  assert.equal(records[0].subject, "Science, lab");
  assert.equal(records[0].title, 'A "quoted"\nreport');
  assert.equal(records[0].weight, 2);
});
test("CSV accepts exact columns in a different order", () => {
  const records = core.parseImport("date,weight,possible,earned,title,subject,year\n2026-10-01,1,20,16,Quiz,Mathematics,2026-2027");
  assert.deepEqual(records, [sample]);
});
test("CSV rejects malformed quoting, missing/duplicate headers, and missing cells", () => {
  for (const text of [header + row + '"', header + '2026-2027,"Unclosed', header + '2026-2027,"Math"junk,Quiz,16,20,1,2026-10-01', "year,subject,title,earned,possible,weight,year\n" + row, header + "2026-2027,Math,Quiz,16,20,1", header]) {
    assert.throws(() => core.parseImport(text), text);
  }
});
test("CSV rejects null characters and checks decoded UTF-8 byte limit", () => {
  assert.throws(() => core.parseImport(header + row + "\0"));
  assert.throws(() => core.parseCsv("é".repeat(core.MAX_BYTES / 2 + 1)), /1 MiB/);
});
test("CSV accepts 500 grade rows and rejects 501 atomically before UI mutation", () => {
  assert.equal(core.parseImport(header + Array(500).fill(row).join("\n")).length, 500);
  assert.throws(() => core.parseImport(header + Array(501).fill(row).join("\n")), /500/);
});
test("records reject nonfinite, negative, excessive, overprecision and impossible scores", () => {
  for (const change of [{earned: "NaN"}, {earned: "Infinity"}, {earned: "1e999"}, {earned: -1}, {possible: 0}, {weight: 0}, {earned: 21}, {weight: 1000000}, {possible: "0.00001"}, {earned: "1.00000"}]) {
    assert.throws(() => core.normalizeRecord({...sample, ...change}), JSON.stringify(change));
  }
  assert.equal(core.normalizeRecord({...sample, earned: 0}).earned, 0);
});
test("calendar and school year validation reject rollover dates and nonconsecutive years", () => {
  assert.equal(core.validDate("2024-02-29"), true);
  assert.equal(core.validDate("2026-02-29"), false);
  assert.equal(core.validDate("2026-02-31"), false);
  assert.equal(core.validDate("0000-01-01"), false);
  assert.equal(core.validDate("2026-1-01"), false);
  assert.equal(core.validYear("2026-2027"), true);
  assert.equal(core.validYear("2026-2028"), false);
  assert.throws(() => core.normalizeRecord({...sample, year: "2026-2028"}));
});
test("CSV export round-trips ordinary records and quotes strings", () => {
  const subjects = [{year: sample.year, name: sample.subject, assessments: [sample]}];
  assert.deepEqual(core.parseImport(core.exportCsv(subjects)), [sample]);
  const quoted = core.exportCsv([{year: sample.year, name: 'Science, lab', assessments: [{...sample, title: 'A "quoted" report'}]}]);
  assert.equal(core.parseImport(quoted)[0].title, 'A "quoted" report');
});
test("CSV export neutralizes spreadsheet formulas, including after whitespace", () => {
  for (const value of ["=HYPERLINK(1)", "+SUM(1)", "-10+20", "@SUM(1)", "  =SUM(1)", "\tformula", "\rformula", "\nformula", " \tformula"]) {
    assert.equal(core.spreadsheetSafe(value), "'" + value);
  }
  const text = core.exportCsv([{year: sample.year, name: "=CMD()", assessments: [{...sample, title: "+SUM(1)"}]}]);
  assert.match(text, /'=CMD\(\)/);
  assert.match(text, /'\+SUM\(1\)/);
});
test("saved browser records are normalized and validated before rendering", () => {
  const saved = {version: 1, subjects: [{id: "subject-1", year: sample.year, name: "<img src=x onerror=alert(1)>", assessments: [{...sample, id: "grade-1", source: "unexpected"}]}]};
  const result = core.validateStored(saved);
  assert.equal(result.subjects[0].name, "<img src=x onerror=alert(1)>");
  assert.equal(result.subjects[0].assessments[0].source, "Manual entry");
  assert.throws(() => core.validateStored({...saved, version: 2}));
  assert.throws(() => core.validateStored({version: 1, subjects: [...saved.subjects, ...saved.subjects]}));
  assert.throws(() => core.validateStored({version: 1, subjects: [{...saved.subjects[0], assessments: [{...saved.subjects[0].assessments[0], possible: 0}]}]}));
});
test("canonical static app disallows native submissions and network connections", () => {
  const html = fs.readFileSync(path.join(__dirname, "../guest-site/index.html"), "utf8");
  assert.match(html, /form-action 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /data-school-login=""/);
  assert.match(html, /href="\.\/assets\/app\.css"/);
  assert.match(html, /src="\.\/assets\/app\.js"/);
  assert.doesNotMatch(html, /\son(?:click|submit|change|load)\s*=/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /id="remember"[^>]*\schecked/);
});

test("guest and account dashboards provide the same closeable three-step guide", () => {
  const guest = fs.readFileSync(path.join(__dirname, "../guest-site/index.html"), "utf8");
  const account = fs.readFileSync(path.join(__dirname, "../templates/includes/quick_guide.html"), "utf8");
  const dashboard = fs.readFileSync(path.join(__dirname, "../templates/grades/dashboard.html"), "utf8");
  for (const source of [guest, account]) {
    assert.match(source, /<details class="quick-guide" open>/);
    assert.match(source, /<summary>5-second guide · How to use Gradebook<\/summary>/);
    for (const step of ["Add a subject.", "Add grades or import CSV.", "Open a subject to try future scores."]) assert.ok(source.includes(step));
  }
  assert.match(dashboard, /include 'includes\/quick_guide.html'/);
});

// A small DOM adapter exercises privacy lifecycle events without a browser dependency.
function guestHarness(storageOptions = {}) {
  const elements = new Map();
  class Element {
    constructor() { this.listeners = new Map(); this.children = []; this.hidden = false; this.value = ""; this.checked = false; this.dataset = {}; this.classList = {toggle() {}}; }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(listener); }
    async emit(name, extra = {}) { for (const listener of this.listeners.get(name) || []) await listener({preventDefault() {}, target: this, currentTarget: this, ...extra}); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    reset() {}
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; for (const listener of this.listeners.get("close") || []) listener({target: this}); }
  }
  const get = (id) => { if (!elements.has(id)) { const element = new Element(); element.id = id; } return elements.get(id); };
  get("detail-view").hidden = true;
  let saved = storageOptions.saved || null;
  let removed = false;
  const document = {
    body: new Element(), getElementById: get, createElement: () => new Element(), querySelector: () => get("brand"), querySelectorAll: () => [],
  };
  document.body.dataset.schoolLogin = "";
  const localStorage = {
    getItem: () => saved,
    setItem: (_key, value) => { if (storageOptions.failSave) throw new Error("Storage quota"); saved = value; },
    removeItem: () => { if (storageOptions.failRemove) throw new Error("Storage denied"); removed = true; saved = null; },
  };
  const context = vm.createContext({document, localStorage, TextEncoder, TextDecoder, URL, Blob, Intl, Date, console, setTimeout, confirm: () => true, location: {href: "https://example.test/guest/", origin: "https://example.test"}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../guest-site/assets/app.js"), "utf8"), context);
  return {get, saved: () => saved, removed: () => removed};
}

test("cancelled file reads cannot reintroduce grades after clear-all", async () => {
  const harness = guestHarness();
  let finishRead;
  harness.get("csv-file").files = [{size: 100, arrayBuffer: () => new Promise((resolve) => { finishRead = resolve; })}];
  const pendingImport = harness.get("import-form").emit("submit");
  harness.get("import-dialog").close();
  await harness.get("clear-data").emit("click");
  finishRead(new TextEncoder().encode(header + row).buffer);
  await pendingImport;
  assert.equal(harness.get("subject-count").textContent, 0);
  assert.equal(harness.get("grade-count").textContent, 0);
  assert.equal(harness.saved(), null);
  assert.match(harness.get("announcement").textContent, /cleared/);
});

test("failed browser saves remove stale snapshots where possible", async () => {
  const harness = guestHarness({failSave: true});
  harness.get("remember").checked = true;
  await harness.get("remember").emit("change");
  assert.equal(harness.removed(), true);
  assert.equal(harness.get("remember").checked, false);
  assert.match(harness.get("announcement").textContent, /previous saved copy was removed/);
  assert.equal(harness.get("storage-status").textContent, "Kept in this tab only");
});

test("unremovable stale snapshots remain visible in privacy status and later notices", async () => {
  const harness = guestHarness({failSave: true, failRemove: true});
  harness.get("remember").checked = true;
  await harness.get("remember").emit("change");
  assert.equal(harness.get("storage-status").textContent, "A saved browser copy may remain");
  await harness.get("sample-load").emit("click");
  assert.match(harness.get("announcement").textContent, /synthetic sample subjects/);
  assert.match(harness.get("announcement").textContent, /previous saved copy may remain/);
});
