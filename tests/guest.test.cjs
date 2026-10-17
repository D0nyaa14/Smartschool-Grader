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
test("new manual grades and predictions count equally while edits preserve original calculations", () => {
  const subject = {name: "Mathematics", year: "2026-2027"};
  const original = {...sample, weight: 3};
  assert.equal(core.manualRecord({...sample, weight: 999}, subject).weight, 1);
  assert.equal(core.manualRecord({...sample, earned: 18, weight: 999}, subject, original).weight, 3);
  assert.equal(original.weight, 3);
  const future = core.futureRecord({earned: 0, possible: 20, weight: 999}, subject, "2026-10-17");
  assert.equal(future.weight, 1);
  assert.equal(future.earned, 0);
  assert.equal(core.simulate([original], [future], 70).projected, 60);
});
test("legacy CSV assessment weights survive import, averaging and backup unchanged", () => {
  const records = core.parseImport(header + "2026-2027,Mathematics,First,10,10,3,2026-10-01\n2026-2027,Mathematics,Second,0,10,1,2026-10-02");
  assert.equal(core.weightedAverage(records), 75);
  assert.deepEqual(core.parseImport(core.exportCsv([{name: "Mathematics", year: "2026-2027", assessments: records}])), records);
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
test("Excel snapshot includes only the selected year and detaches recorded grades", () => {
  const subjects = [
    {id: "current", name: "Mathematics", year: "2026-2027", assessments: [{...sample, id: "grade-current", source: "Manual entry"}]},
    {id: "older", name: "Biology", year: "2025-2026", assessments: [{...sample, id: "grade-old", source: "CSV import"}]},
  ];
  const generatedAt = new Date("2026-10-17T12:00:00Z");
  const result = core.reportSnapshot(subjects, "2026-2027", generatedAt);
  assert.deepEqual(result.subjects, [{id: "current", name: "Mathematics", year: "2026-2027"}]);
  assert.equal(result.grades.length, 1);
  assert.equal(result.grades[0].subjectId, "current");
  assert.equal(result.generatedAt, generatedAt);
  assert.equal(result.year, "2026-2027");
  assert.equal(Object.hasOwn(result, "simulations"), false);
  result.grades[0].earned = 0;
  result.subjects[0].name = "Changed export copy";
  assert.equal(subjects[0].assessments[0].earned, 16);
  assert.equal(subjects[0].name, "Mathematics");
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
  assert.ok(html.indexOf('./assets/excel-report.js') < html.indexOf('./assets/app.js'));
  assert.match(html, /id="export-excel"[^>]*disabled>↓ Download Excel report/);
  assert.match(html, /id="export-data"[^>]*>CSV backup/);
  assert.doesNotMatch(html, /\son(?:click|submit|change|load)\s*=/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /id="remember"[^>]*\schecked/);
  assert.doesNotMatch(html, /(?:id|name|for)="(?:grade-)?weight"/);
  assert.doesNotMatch(html, /<th[^>]*>Weight<\/th>/);
  assert.doesNotMatch(html, /Relative weight|Weighted averages|Your weighted average|weight-help/);
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
  const downloads = [];
  const blobs = [];
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
    click() { downloads.push({href: this.href, filename: this.download}); }
    remove() {}
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
  class HarnessURL extends URL {
    static createObjectURL(blob) { blobs.push(blob); return "blob:guest-test"; }
    static revokeObjectURL() {}
  }
  class HarnessFormData {
    constructor(form) {
      this.values = form.id === "grade-form" ? Object.fromEntries(["title", "earned", "possible", "date"].map((name) => [name, get(`grade-${name}`).value])) : {};
      Object.assign(this.values, storageOptions.formDataOverrides || {});
    }
    entries() { return Object.entries(this.values); }
  }
  const context = vm.createContext({document, localStorage, FormData: HarnessFormData, TextEncoder, TextDecoder, URL: HarnessURL, Blob, Uint8Array, Intl, Date, console, setTimeout: (callback) => { callback(); return 0; }, confirm: () => true, location: {href: "https://example.test/guest/", origin: "https://example.test"}, GradebookExcel: storageOptions.excelBuilder ? {buildReport: storageOptions.excelBuilder} : undefined});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../guest-site/assets/app.js"), "utf8"), context);
  return {get, has: (id) => elements.has(id), saved: () => saved, removed: () => removed, downloads, blobs};
}

test("manual form hides the option, preserves edited imports and fixes new grades at one", async () => {
  const saved = {version: 1, subjects: [{id: "subject-current", name: "Mathematics", year: "2026-2027", assessments: [{...sample, id: "grade-original", weight: 3, source: "CSV import"}]}]};
  const harness = guestHarness({saved: JSON.stringify(saved), formDataOverrides: {weight: "999"}});
  const card = harness.get("subject-grid").children[0];
  await card.children.at(-1).children[0].emit("click");
  const row = harness.get("assessment-body").children[0];
  assert.equal(row.children.length, 3);
  await row.children.at(-1).children[0].children[0].emit("click");
  harness.get("grade-earned").value = "18";
  await harness.get("grade-form").emit("submit");
  let records = JSON.parse(harness.saved()).subjects[0].assessments;
  assert.equal(records[0].weight, 3);
  assert.equal(records[0].earned, 18);
  await harness.get("grade-open").emit("click");
  for (const [name, value] of Object.entries({title: "New quiz", earned: "10", possible: "20", date: "2026-10-17"})) harness.get(`grade-${name}`).value = value;
  await harness.get("grade-form").emit("submit");
  records = JSON.parse(harness.saved()).subjects[0].assessments;
  assert.equal(records.length, 2);
  assert.equal(records[0].weight, 3);
  assert.equal(records[1].weight, 1);
  assert.equal(harness.has("grade-weight"), false);
});

test("prediction rows have points only and add an equal-count result to legacy records", async () => {
  const saved = {version: 1, subjects: [{id: "subject-current", name: "Mathematics", year: "2026-2027", assessments: [{...sample, id: "grade-original", weight: 3, source: "CSV import"}]}]};
  const harness = guestHarness({saved: JSON.stringify(saved)});
  await harness.get("subject-grid").children[0].children.at(-1).children[0].emit("click");
  for (let index = 0; index < 3; index += 1) {
    assert.equal(harness.has(`future-${index}-earned`), true);
    assert.equal(harness.has(`future-${index}-possible`), true);
    assert.equal(harness.has(`future-${index}-weight`), false);
  }
  harness.get("future-0-earned").value = "0";
  harness.get("future-0-possible").value = "20";
  harness.get("target").value = "70";
  await harness.get("simulation-form").emit("submit");
  assert.equal(harness.get("projected-average").textContent, "60%");
  assert.equal(harness.get("simulation-result").hidden, false);
  assert.doesNotMatch(harness.get("target-result").textContent, /weight/);
  assert.equal(JSON.parse(harness.saved()).subjects[0].assessments[0].weight, 3);
});

test("Excel button downloads a local selected-year report while CSV backs up all years", async () => {
  const saved = {version: 1, subjects: [
    {id: "subject-current", name: "Mathematics", year: "2026-2027", assessments: [{...sample, id: "grade-current", source: "Manual entry"}]},
    {id: "subject-older", name: "Biology", year: "2025-2026", assessments: [{...sample, id: "grade-older", source: "CSV import"}]},
  ]};
  let input;
  const harness = guestHarness({saved: JSON.stringify(saved), excelBuilder: (snapshot) => { input = snapshot; return new Uint8Array([80, 75, 3, 4]); }});
  assert.equal(harness.get("export-excel").disabled, false);
  assert.equal(harness.get("export-excel-top").disabled, false);
  assert.equal(harness.get("export-excel-top")["aria-label"], "Download Excel report for 2026-2027");
  await harness.get("export-excel").emit("click");
  assert.equal(input.year, "2026-2027");
  assert.equal(input.subjects.length, 1);
  assert.equal(input.grades.length, 1);
  assert.equal(input.grades[0].subjectId, "subject-current");
  assert.equal(harness.downloads[0].filename, "gradebook-progress-2026-2027.xlsx");
  assert.equal(harness.blobs[0].type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.match(harness.get("announcement").textContent, /generated locally/);
  assert.match(harness.get("export-scope").textContent, /simulations excluded/);
  await harness.get("export-excel-top").emit("click");
  assert.equal(harness.downloads[1].filename, "gradebook-progress-2026-2027.xlsx");
  assert.equal(harness.blobs[1].type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  await harness.get("export-data").emit("click");
  const csv = await harness.blobs[2].text();
  assert.equal(core.parseImport(csv).length, 2);
  assert.equal(harness.downloads[2].filename, "my-guest-grades.csv");
});

test("Excel control disables empty years and reports generator failures honestly", async () => {
  const empty = guestHarness();
  assert.equal(empty.get("export-excel").disabled, true);
  assert.equal(empty.get("export-excel-top").disabled, true);
  const saved = {version: 1, subjects: [{id: "subject-current", name: "Mathematics", year: "2026-2027", assessments: [{...sample, id: "grade-current", source: "Manual entry"}]}]};
  const harness = guestHarness({saved: JSON.stringify(saved), excelBuilder: () => { throw new Error("Report tool unavailable."); }});
  await harness.get("export-excel").emit("click");
  assert.equal(harness.downloads.length, 0);
  assert.match(harness.get("announcement").textContent, /Excel report unavailable/);
  assert.match(harness.get("announcement").textContent, /grades have not changed/);
  assert.equal(harness.get("export-excel").disabled, false);
  assert.equal(harness.get("export-excel-top").disabled, false);
  harness.get("year-filter").value = "2025-2026";
  await harness.get("year-filter").emit("change");
  assert.equal(harness.get("export-excel").disabled, true);
  assert.equal(harness.get("export-excel-top").disabled, true);
  assert.equal(harness.get("export-data").disabled, false);
});

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
