"use strict";

(function () {
  const COLUMNS = ["year", "subject", "title", "earned", "possible", "weight", "date"];
  const MAX_BYTES = 1048576;
  const MAX_ROWS = 500;
  const MAX_SUBJECTS = 500;
  const MAX_GRADES = 5000;
  const STORAGE_KEY = "gradebook.guest.v1";

  function requireCondition(condition, message) {
    if (!condition) throw new Error(message);
  }

  function numeric(value, label, minimum = 0) {
    const text = String(value).trim();
    requireCondition(/^(?:\d+(?:\.\d{0,4})?|\.\d{1,4})$/.test(text), `${label}: use a decimal number with up to four decimal places.`);
    const number = Number(text);
    requireCondition(Number.isFinite(number) && number >= minimum && number <= 999999, `${label}: use a number between ${minimum} and 999999.`);
    return number;
  }

  function validYear(value) {
    return /^\d{4}-\d{4}$/.test(value) && Number(value.slice(5)) === Number(value.slice(0, 4)) + 1;
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && Number(value.slice(0, 4)) > 0;
  }

  function cleanText(value, label, maximum) {
    requireCondition(typeof value === "string", `${label} is missing.`);
    const text = value.trim();
    requireCondition(text.length > 0 && text.length <= maximum && !text.includes("\0"), `${label}: use between 1 and ${maximum} characters, without null characters.`);
    return text;
  }

  function normalizeRecord(record) {
    const year = String(record.year || "").trim();
    const date = String(record.date || "").trim();
    requireCondition(validYear(year), "Use consecutive school years, such as 2026-2027.");
    requireCondition(validDate(date), "Use a valid date in YYYY-MM-DD format.");
    const earned = numeric(record.earned, "Points earned");
    const possible = numeric(record.possible, "Maximum points", 0.0001);
    const weight = numeric(record.weight, "Weight", 0.0001);
    requireCondition(earned <= possible, "Points earned cannot exceed maximum points. Extra credit is not supported.");
    return {year, subject: cleanText(record.subject, "Subject", 100), title: cleanText(record.title, "Assessment title", 120), earned, possible, weight, date};
  }

  function weightedAverage(records) {
    let weighted = 0;
    let weight = 0;
    for (const record of records) {
      weighted += record.earned / record.possible * 100 * record.weight;
      weight += record.weight;
    }
    return weight > 0 ? weighted / weight : null;
  }

  function simulate(records, future, target) {
    requireCondition(future.length > 0 && future.length <= 3, "Add one to three complete future assessments.");
    requireCondition(Number.isFinite(target) && target >= 0 && target <= 100, "Use a target between 0 and 100%.");
    const currentWeight = records.reduce((sum, record) => sum + record.weight, 0);
    const currentWeighted = records.reduce((sum, record) => sum + record.earned / record.possible * 100 * record.weight, 0);
    const futureWeight = future.reduce((sum, record) => sum + record.weight, 0);
    const needed = (target * (currentWeight + futureWeight) - currentWeighted) / futureWeight;
    return {projected: weightedAverage(records.concat(future)), needed, target, status: needed < 0 ? "already" : needed > 100 ? "impossible" : "achievable"};
  }

  // Strict CSV state machine: quoted commas/newlines and doubled quotes are supported.
  function parseCsv(text) {
    requireCondition(typeof text === "string" && new TextEncoder().encode(text).length <= MAX_BYTES, "The CSV must be no larger than 1 MiB.");
    requireCondition(!text.includes("\0"), "The CSV contains unsupported null characters.");
    text = text.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    let afterQuote = false;
    function finishCell() { row.push(cell); cell = ""; afterQuote = false; }
    function finishRow() {
      finishCell();
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
      requireCondition(rows.length <= MAX_ROWS + 1, `Import at most ${MAX_ROWS} records at a time.`);
    }
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"') {
          if (text[index + 1] === '"') { cell += '"'; index += 1; }
          else { quoted = false; afterQuote = true; }
        } else cell += character;
      } else if (character === ",") finishCell();
      else if (character === "\r" || character === "\n") {
        finishRow();
        if (character === "\r" && text[index + 1] === "\n") index += 1;
      } else if (character === '"') {
        requireCondition(cell === "" && !afterQuote, "The CSV has an unexpected quote. Check quoted fields.");
        quoted = true;
      } else {
        requireCondition(!afterQuote, "The CSV has text after a closing quote.");
        cell += character;
      }
    }
    requireCondition(!quoted, "The CSV has an unclosed quoted field.");
    if (cell !== "" || row.length || afterQuote) finishRow();
    return rows;
  }

  function parseImport(text) {
    const rows = parseCsv(text);
    requireCondition(rows.length >= 2, "The CSV must contain a header and at least one grade.");
    const headers = rows[0];
    requireCondition(headers.length === COLUMNS.length && new Set(headers).size === COLUMNS.length && COLUMNS.every((name) => headers.includes(name)), `Use exactly these column names: ${COLUMNS.join(",")}`);
    return rows.slice(1).map((row, index) => {
      try {
        requireCondition(row.length === headers.length, "Every column must have a value.");
        const record = {};
        headers.forEach((header, column) => { record[header] = row[column]; });
        return normalizeRecord(record);
      } catch (error) { throw new Error(`Record ${index + 1}: ${error.message}`); }
    });
  }

  function spreadsheetSafe(value) {
    const text = String(value);
    return /^[\s\uFEFF]*[=+@\-\t\r\n]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  }

  function csvCell(value) {
    const safe = spreadsheetSafe(value);
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  }

  function exportCsv(subjects) {
    const lines = [COLUMNS.join(",")];
    for (const subject of subjects) {
      for (const grade of subject.assessments) {
        lines.push([subject.year, subject.name, grade.title, grade.earned, grade.possible, grade.weight, grade.date].map(csvCell).join(","));
      }
    }
    return lines.join("\r\n") + "\r\n";
  }

  function validateStored(value) {
    requireCondition(value && value.version === 1 && Array.isArray(value.subjects) && value.subjects.length <= MAX_SUBJECTS, "Saved guest data has an unsupported format.");
    let total = 0;
    const identifiers = new Set();
    const subjects = value.subjects.map((subject) => {
      const name = cleanText(subject.name, "Subject", 100);
      requireCondition(typeof subject.year === "string" && validYear(subject.year) && Array.isArray(subject.assessments), "Saved subject data is invalid.");
      const id = cleanText(subject.id, "Record identifier", 80);
      requireCondition(!identifiers.has(id), "Saved data contains duplicate identifiers.");
      identifiers.add(id);
      const assessments = subject.assessments.map((grade) => {
        total += 1;
        requireCondition(total <= MAX_GRADES, "Saved data has too many grades.");
        const record = normalizeRecord({...grade, subject: name, year: subject.year});
        const gradeId = cleanText(grade.id, "Record identifier", 80);
        requireCondition(!identifiers.has(gradeId), "Saved data contains duplicate identifiers.");
        identifiers.add(gradeId);
        return {id: gradeId, title: record.title, earned: record.earned, possible: record.possible, weight: record.weight, date: record.date, source: ["Manual entry", "CSV import", "Synthetic sample"].includes(grade.source) ? grade.source : "Manual entry"};
      });
      return {id, name, year: subject.year, assessments};
    });
    return {version: 1, subjects};
  }

  const core = {COLUMNS, MAX_BYTES, MAX_ROWS, numeric, validYear, validDate, normalizeRecord, weightedAverage, simulate, parseCsv, parseImport, spreadsheetSafe, exportCsv, validateStored};
  if (typeof module !== "undefined" && module.exports) module.exports = core;
  if (typeof document === "undefined") return;

  const byId = (id) => document.getElementById(id);
  const format = new Intl.NumberFormat(undefined, {maximumFractionDigits: 2});
  const percent = (value) => value === null ? "—" : `${format.format(value)}%`;
  const today = new Date();
  const schoolStart = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
  const currentYear = `${schoolStart}-${schoolStart + 1}`;
  const todayText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  let state = {version: 1, subjects: []};
  let remember = false;
  let selectedYear = currentYear;
  let selectedSubjectId = null;
  let editingGradeId = null;
  let importBusy = false;
  let importEpoch = 0;
  let storageWarning = "";
  let savedCopyMayRemain = false;

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function announce(message, error = false) {
    if (storageWarning && !error) { message += ` ${storageWarning}`; error = true; }
    const element = byId("announcement");
    element.textContent = message;
    element.classList.toggle("error", error);
    element.hidden = false;
  }
  function showError(id, message) {
    byId(id).textContent = message;
    byId(id).hidden = !message;
  }
  function newId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
  function selectedSubject() { return state.subjects.find((subject) => subject.id === selectedSubjectId); }
  function gradeCount() { return state.subjects.reduce((count, subject) => count + subject.assessments.length, 0); }
  function saveState() {
    if (!remember) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageWarning = ""; savedCopyMayRemain = false;
    }
    catch (_) {
      try { localStorage.removeItem(STORAGE_KEY); savedCopyMayRemain = false; }
      catch (_) { savedCopyMayRemain = true; }
      storageWarning = savedCopyMayRemain ? "Browser saving failed. A previous saved copy may remain; remove this site’s storage in your browser settings. Export current grades before leaving." : "Browser saving failed and any previous saved copy was removed. Export current grades before refreshing or leaving.";
      remember = false;
      byId("remember").checked = false;
      updateStorageCopy();
      announce(storageWarning, true);
    }
  }
  function updateStorageCopy() {
    byId("storage-status").textContent = savedCopyMayRemain ? "A saved browser copy may remain" : remember ? "Saved on this browser" : "Kept in this tab only";
    byId("storage-description").textContent = savedCopyMayRemain ? "Current changes are unsaved. Remove this site’s saved data in your browser settings." : remember ? "Saved grades can be seen by anyone using this browser. Clear them when finished." : "Refreshing or closing this page clears unsaved grades. Export a copy to keep them.";
  }
  function makeButton(text, className, handler, accessibleName) {
    const button = makeElement("button", className, text);
    button.type = "button";
    if (accessibleName) button.setAttribute("aria-label", accessibleName);
    button.addEventListener("click", handler);
    return button;
  }
  function renderOverview() {
    const years = [...new Set([currentYear, selectedYear, ...state.subjects.map((subject) => subject.year)])].sort().reverse();
    byId("year-filter").replaceChildren(...years.map((year) => {
      const option = makeElement("option", "", year);
      option.value = year;
      option.selected = year === selectedYear;
      return option;
    }));
    const subjects = state.subjects.filter((subject) => subject.year === selectedYear).sort((a, b) => a.name.localeCompare(b.name));
    byId("subject-count").textContent = subjects.length;
    byId("grade-count").textContent = subjects.reduce((sum, subject) => sum + subject.assessments.length, 0);
    byId("year-summary").textContent = selectedYear;
    byId("empty-state").hidden = subjects.length > 0;
    byId("subject-grid").replaceChildren(...subjects.map((subject) => {
      const average = weightedAverage(subject.assessments);
      const card = makeElement("article", "subject-card");
      const top = makeElement("div", "subject-card-top");
      const symbol = makeElement("span", "subject-symbol", Array.from(subject.name)[0].toUpperCase());
      symbol.setAttribute("aria-hidden", "true");
      top.append(symbol, makeElement("span", "source", "Guest tracker"));
      const heading = makeElement("h3", "", subject.name);
      const score = makeElement("div", "subject-score", average === null ? "—" : format.format(average));
      if (average !== null) score.append(makeElement("span", "", "%"));
      const progress = makeElement("progress");
      progress.max = 100;
      progress.value = average || 0;
      progress.setAttribute("aria-label", `${subject.name}: ${average === null ? "no average yet" : percent(average) + " weighted average"}`);
      const metadata = makeElement("div", "subject-meta");
      metadata.append(makeElement("span", "", `${subject.assessments.length} assessment${subject.assessments.length === 1 ? "" : "s"}`), makeElement("span", "", average === null ? "Ready for your first grade" : "Weighted average"));
      const bottom = makeElement("div", "subject-card-bottom");
      bottom.append(makeButton("View subject →", "text-button", () => openSubject(subject.id), `View ${subject.name}`), makeButton("＋ Add grade", "text-button", () => { selectedSubjectId = subject.id; openGrade(); }, `Add grade for ${subject.name}`));
      card.append(top, heading, makeElement("div", "subject-year", subject.year), score, progress, metadata, bottom);
      return card;
    }));
    byId("export-data").disabled = gradeCount() === 0;
  }
  function renderDetail() {
    const subject = selectedSubject();
    if (!subject) { showOverview(); return; }
    byId("detail-title").textContent = subject.name;
    byId("detail-year").textContent = `${subject.year} · Your subject`;
    byId("detail-average").textContent = percent(weightedAverage(subject.assessments));
    byId("assessment-count").textContent = `${subject.assessments.length} recorded`;
    byId("assessment-caption").textContent = `Recorded grades for ${subject.name} in ${subject.year}`;
    byId("assessment-empty").hidden = subject.assessments.length > 0;
    const grades = [...subject.assessments].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
    byId("assessment-body").replaceChildren(...grades.map((grade) => {
      const row = makeElement("tr");
      const title = makeElement("td");
      title.append(makeElement("strong", "assessment-name", grade.title), makeElement("span", "assessment-meta", `${grade.date} · ${grade.source}`));
      const score = makeElement("td", "numeric");
      score.append(makeElement("span", "score-pill", percent(grade.earned / grade.possible * 100)), makeElement("span", "assessment-meta", `${format.format(grade.earned)} / ${format.format(grade.possible)}`));
      const actions = makeElement("td");
      const buttons = makeElement("div", "table-actions");
      buttons.append(makeButton("Edit", "text-button", () => openGrade(grade.id), `Edit ${grade.title}`), makeButton("Remove", "text-button danger-text", () => {
        if (!confirm(`Remove “${grade.title}” from ${subject.name}? This cannot be undone.`)) return;
        subject.assessments = subject.assessments.filter((item) => item.id !== grade.id);
        saveState(); renderAll(); resetSimulation(); announce("Grade removed. Your average has been recalculated.");
      }, `Remove ${grade.title}`));
      actions.append(buttons);
      row.append(title, score, makeElement("td", "numeric", `${format.format(grade.weight)}×`), actions);
      return row;
    }));
  }
  function renderAll() {
    renderOverview();
    if (!byId("detail-view").hidden) renderDetail();
  }
  function showOverview() {
    byId("overview-view").hidden = false;
    byId("detail-view").hidden = true;
    renderOverview();
  }
  function openSubject(id) {
    selectedSubjectId = id;
    byId("overview-view").hidden = true;
    byId("detail-view").hidden = false;
    resetSimulation(); renderDetail();
    byId("detail-title").focus();
  }
  function resetSimulation() {
    byId("simulation-form").reset();
    byId("simulation-result").hidden = true;
    showError("simulation-error", "");
  }
  function openSubjectForm() {
    byId("subject-form").reset();
    byId("subject-year").value = selectedYear;
    showError("subject-error", "");
    byId("subject-dialog").showModal();
  }
  function openGrade(id = null) {
    const subject = selectedSubject();
    if (!subject) { openSubjectForm(); return; }
    editingGradeId = id;
    const grade = id ? subject.assessments.find((item) => item.id === id) : null;
    byId("grade-form").reset();
    byId("grade-subject-name").textContent = subject.name;
    byId("grade-dialog-title").textContent = grade ? "Edit your grade" : "Add a grade";
    byId("grade-save").textContent = grade ? "Save changes ✓" : "Add grade ✓";
    for (const name of ["title", "earned", "possible", "weight", "date"]) {
      byId(`grade-${name}`).value = grade ? grade[name] : name === "weight" ? "1" : name === "date" ? todayText : "";
    }
    showError("grade-error", "");
    byId("grade-dialog").showModal();
  }

  byId("subject-open").addEventListener("click", openSubjectForm);
  byId("first-subject").addEventListener("click", openSubjectForm);
  byId("grade-open").addEventListener("click", () => openGrade());
  byId("detail-back").addEventListener("click", showOverview);
  document.querySelector(".brand").addEventListener("click", (event) => { event.preventDefault(); showOverview(); });
  byId("year-filter").addEventListener("change", (event) => { selectedYear = event.target.value; renderOverview(); });
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.close === "import-dialog") importEpoch += 1;
    byId(button.dataset.close).close();
  }));

  byId("subject-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      requireCondition(state.subjects.length < MAX_SUBJECTS, `This workspace supports up to ${MAX_SUBJECTS} subjects.`);
      const name = cleanText(byId("subject-name").value, "Subject", 100);
      const year = byId("subject-year").value.trim();
      requireCondition(validYear(year), "Use consecutive school years, such as 2026-2027.");
      requireCondition(!state.subjects.some((subject) => subject.name === name && subject.year === year), "You already have this subject in that school year.");
      const subject = {id: newId(), name, year, assessments: []};
      state.subjects.push(subject); selectedYear = year; selectedSubjectId = subject.id;
      saveState(); byId("subject-dialog").close(); renderOverview(); openSubject(subject.id); announce("Subject added. You can now enter a grade.");
    } catch (error) { showError("subject-error", error.message); }
  });

  byId("grade-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const subject = selectedSubject();
      requireCondition(!!subject, "Choose a subject first.");
      requireCondition(editingGradeId || gradeCount() < MAX_GRADES, `This workspace supports up to ${MAX_GRADES} assessments. Export a copy and clear older data to make space.`);
      const data = Object.fromEntries(new FormData(event.currentTarget).entries());
      const record = normalizeRecord({...data, subject: subject.name, year: subject.year});
      const grade = {id: editingGradeId || newId(), title: record.title, earned: record.earned, possible: record.possible, weight: record.weight, date: record.date, source: "Manual entry"};
      if (editingGradeId) subject.assessments = subject.assessments.map((item) => item.id === editingGradeId ? grade : item);
      else subject.assessments.push(grade);
      saveState(); byId("grade-dialog").close(); renderAll(); resetSimulation(); announce(editingGradeId ? "Grade updated." : "Grade added.");
    } catch (error) { showError("grade-error", error.message); }
  });

  byId("subject-remove").addEventListener("click", () => {
    const subject = selectedSubject();
    if (!subject || !confirm(`Permanently remove “${subject.name}” and all its grades?`)) return;
    state.subjects = state.subjects.filter((item) => item.id !== subject.id);
    selectedSubjectId = null; saveState(); showOverview(); announce("Subject and its grades removed.");
  });

  for (let index = 0; index < 3; index += 1) {
    const container = byId("future-rows");
    container.append(makeElement("div", "future-label", `Future assessment ${index + 1}`));
    const row = makeElement("div", "future-row");
    for (const [name, labelText, minimum] of [["earned", "Expected points", "0"], ["possible", "Maximum points", "0.0001"], ["weight", "Weight", "0.0001"]]) {
      const field = makeElement("div", "field");
      const label = makeElement("label", "", labelText);
      const input = makeElement("input");
      input.id = `future-${index}-${name}`; input.name = input.id; input.type = "number"; input.min = minimum; input.max = "999999"; input.step = "0.0001";
      label.htmlFor = input.id;
      field.append(label, input); row.append(field);
    }
    container.append(row);
  }
  byId("simulation-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const subject = selectedSubject();
      requireCondition(!!subject, "Choose a subject first.");
      const future = [];
      for (let index = 0; index < 3; index += 1) {
        const record = {};
        for (const name of ["earned", "possible", "weight"]) record[name] = byId(`future-${index}-${name}`).value.trim();
        if (Object.values(record).every((value) => value === "")) continue;
        requireCondition(Object.values(record).every((value) => value !== ""), `Future assessment ${index + 1}: enter points earned, maximum points, and weight, or leave the whole row blank.`);
        const parsed = normalizeRecord({...record, year: subject.year, subject: subject.name, title: "Future assessment", date: todayText});
        future.push(parsed);
      }
      const target = numeric(byId("target").value, "Target average");
      const result = simulate(subject.assessments, future, target);
      byId("projected-average").textContent = percent(result.projected);
      byId("target-result").textContent = result.status === "impossible" ? `A ${format.format(target)}% target needs more than 100% across these future weights. Add more future assessments or adjust your target.` : result.status === "already" ? `Your ${format.format(target)}% target is secured for these future weights, even with a 0% future average.` : `You need a weighted average of ${format.format(result.needed)}% across these future assessments to reach ${format.format(target)}%.`;
      byId("simulation-result").hidden = false; showError("simulation-error", "");
    } catch (error) { byId("simulation-result").hidden = true; showError("simulation-error", error.message); }
  });
  byId("simulation-form").addEventListener("input", () => { byId("simulation-result").hidden = true; showError("simulation-error", ""); });

  byId("import-open").addEventListener("click", () => {
    byId("import-form").reset(); showError("import-error", ""); byId("import-dialog").showModal();
  });
  for (const eventName of ["cancel", "close"]) byId("import-dialog").addEventListener(eventName, () => { importEpoch += 1; });
  byId("import-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (importBusy) return;
    importBusy = true; byId("import-submit").disabled = true;
    const operation = ++importEpoch;
    try {
      const file = byId("csv-file").files[0];
      requireCondition(!!file, "Choose a CSV file first.");
      requireCondition(file.size <= MAX_BYTES, "The CSV must be no larger than 1 MiB.");
      let text;
      try { text = new TextDecoder("utf-8", {fatal: true}).decode(await file.arrayBuffer()); }
      catch (_) { throw new Error("Save your CSV as UTF-8 and try again."); }
      if (operation !== importEpoch) return;
      const records = parseImport(text);
      const next = JSON.parse(JSON.stringify(state));
      let imported = 0;
      let skipped = 0;
      for (const record of records) {
        let subject = next.subjects.find((item) => item.name === record.subject && item.year === record.year);
        if (!subject) { subject = {id: newId(), name: record.subject, year: record.year, assessments: []}; next.subjects.push(subject); }
        const duplicate = subject.assessments.some((grade) => ["title", "earned", "possible", "weight", "date"].every((name) => grade[name] === record[name]));
        if (duplicate) { skipped += 1; continue; }
        subject.assessments.push({id: newId(), title: record.title, earned: record.earned, possible: record.possible, weight: record.weight, date: record.date, source: "CSV import"});
        imported += 1;
      }
      requireCondition(next.subjects.length <= MAX_SUBJECTS && next.subjects.reduce((sum, subject) => sum + subject.assessments.length, 0) <= MAX_GRADES, `The workspace supports up to ${MAX_SUBJECTS} subjects and ${MAX_GRADES} grades. No rows were imported.`);
      state = next; selectedYear = records[0].year; saveState(); byId("import-dialog").close(); showOverview(); announce(`Imported ${imported} grades. Skipped ${skipped} exact duplicates.`);
    } catch (error) { showError("import-error", error.message); }
    finally { importBusy = false; byId("import-submit").disabled = false; }
  });

  byId("export-data").addEventListener("click", () => {
    const blob = new Blob([exportCsv(state.subjects)], {type: "text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = makeElement("a");
    link.href = url; link.download = "my-guest-grades.csv"; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce("Your CSV export is ready. Store it somewhere private. Formula-like subject and assessment names are prefixed with an apostrophe for spreadsheet safety.");
  });

  byId("remember").addEventListener("change", (event) => {
    remember = event.target.checked;
    if (remember) {
      saveState();
      if (remember) announce("Browser saving enabled. Anyone using this browser can access these guest grades.");
    } else {
      try { localStorage.removeItem(STORAGE_KEY); storageWarning = ""; savedCopyMayRemain = false; announce("Browser saving disabled and saved guest records removed. Current grades remain in this tab until you refresh or leave."); }
      catch (_) { savedCopyMayRemain = true; storageWarning = "Browser saving is off, but saved data could not be removed. Clear this site’s storage in your browser settings."; announce(storageWarning, true); }
    }
    updateStorageCopy();
  });
  byId("clear-data").addEventListener("click", () => {
    if (!confirm("Clear all guest subjects, grades, and saved browser data? This cannot be undone. Export a CSV first if you need a copy.")) return;
    importEpoch += 1;
    let cleared = true;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { cleared = false; }
    state = {version: 1, subjects: []}; remember = false; selectedYear = currentYear; selectedSubjectId = null; byId("remember").checked = false;
    savedCopyMayRemain = !cleared; storageWarning = cleared ? "" : "Browser storage could not be cleared; remove this site’s saved data in your browser settings.";
    updateStorageCopy(); showOverview();
    announce(cleared ? "All guest grades and saved browser data have been cleared." : "Current guest grades were cleared. Browser storage could not be cleared; remove this site’s saved data in your browser settings.", !cleared);
  });

  function loadSamples() {
    if (state.subjects.length && !confirm("Add synthetic sample subjects to your current guest workspace? Your existing grades will stay.")) return;
    const definitions = [
      {name: "Mathematics · sample", grades: [["Algebra quiz", 16, 20, 1], ["Problem solving", 34, 40, 2], ["Geometry test", 42, 50, 2]]},
      {name: "Biology · sample", grades: [["Cell biology", 18, 20, 1], ["Lab report", 25, 30, 2]]},
      {name: "English · sample", grades: [["Reading response", 15, 20, 1], ["Essay", 34, 40, 3]]},
    ];
    let added = 0;
    for (const definition of definitions) {
      if (state.subjects.some((subject) => subject.year === selectedYear && subject.name === definition.name)) continue;
      if (state.subjects.length >= MAX_SUBJECTS || gradeCount() + definition.grades.length > MAX_GRADES) break;
      state.subjects.push({id: newId(), name: definition.name, year: selectedYear, assessments: definition.grades.map(([title, earned, possible, weight]) => ({id: newId(), title, earned, possible, weight, date: todayText, source: "Synthetic sample"}))});
      added += 1;
    }
    saveState(); showOverview(); announce(added ? `Added ${added} synthetic sample subjects. These are fictional practice records.` : "Sample subjects are already present, or the workspace is full.");
  }
  byId("sample-load").addEventListener("click", loadSamples);
  byId("sample-load-secondary").addEventListener("click", loadSamples);

  const configuredLogin = document.body.dataset.schoolLogin.trim();
  if (configuredLogin) {
    try {
      const url = new URL(configuredLogin, location.href);
      const relativePath = configuredLogin.startsWith("/") && !configuredLogin.startsWith("//") && url.origin === location.origin;
      if (!url.username && !url.password && (url.protocol === "https:" || relativePath)) {
        byId("school-login").href = url.href; byId("school-login").hidden = false; byId("school-unconfigured").hidden = true;
        byId("school-login").addEventListener("click", (event) => {
          if (!remember && gradeCount() && !confirm("Guest grades are separate from school sign-in. Export a copy before leaving. Continue to school sign-in?")) event.preventDefault();
        });
      }
    } catch (_) { /* Invalid operator configuration leaves school sign-in unavailable. */ }
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      requireCondition(saved.length <= 8 * MAX_BYTES, "Saved data is too large to load safely.");
      state = validateStored(JSON.parse(saved));
      remember = true; byId("remember").checked = true;
      if (state.subjects.length) selectedYear = state.subjects.map((subject) => subject.year).sort().reverse()[0];
      announce("Restored the guest grades you previously chose to save on this browser.");
    }
  } catch (_) {
    savedCopyMayRemain = true;
    storageWarning = "Saved guest data could not be restored or checked. This workspace started empty; use Clear all guest data to remove an unreadable saved copy.";
    announce(storageWarning, true);
  }
  updateStorageCopy(); renderOverview();
})();
