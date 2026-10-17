/* Browser-local OOXML export. No network, dependencies, macros, or user formulas. */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GradebookExcel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const NAVY = "173B57";
  const BLUE = "245F8F";
  const GLACIER = "8FC4E3";
  const encoder = new TextEncoder();
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  function xml(value) {
    let clean = "";
    for (const character of String(value)) {
      const code = character.codePointAt(0);
      if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff)) clean += character;
    }
    return clean.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const textCell = (ref, value, style = 0) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  const numberCell = (ref, value, style = 0, formula = null) => `<c r="${ref}" s="${style}">${formula === null ? "" : `<f>${xml(formula)}</f>`}<v>${value}</v></c>`;
  const textFormulaCell = (ref, value, formula) => `<c r="${ref}" t="str"><f>${xml(formula)}</f><v>${xml(value)}</v></c>`;
  const blankCell = (ref, style = 0) => `<c r="${ref}" s="${style}"/>`;
  const row = (index, cells, height = 22) => `<row r="${index}" ht="${height}" customHeight="1">${cells.join("")}</row>`;
  const range = (sheet, column, start, end) => `'${sheet}'!$${column}$${start}:$${column}$${end}`;
  const dateLabel = value => value.slice(8,10)+" "+["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(value.slice(5,7))-1];
  function excelDate(value) {
    const milliseconds = typeof value === "string" ? Date.parse(value + "T00:00:00Z") : value.getTime();
    ensure(Number.isFinite(milliseconds) && milliseconds >= Date.UTC(1900, 0, 1), "Excel report dates must be valid dates from 1900 onward.");
    const serial = (milliseconds - Date.UTC(1899, 11, 31)) / 86400000;
    return serial + (milliseconds >= Date.UTC(1900, 2, 1) ? 1 : 0);
  }
  function numeric(value, minimum, label) {
    ensure(typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= 999999, `${label} must be a finite number between ${minimum} and 999999.`);
    ensure(Math.abs(value * 10000 - Math.round(value * 10000)) < 0.00001, `${label} supports up to four decimal places.`);
    return value;
  }
  function prepare(input) {
    ensure(input && Array.isArray(input.subjects) && Array.isArray(input.grades), "Provide subjects and grades for the report.");
    ensure(input.subjects.length <= 500 && input.grades.length <= 5000, "Export at most 500 subjects and 5000 grades.");
    ensure(typeof input.year === "string" && /^\d{4}-\d{4}$/.test(input.year) && Number(input.year.slice(5)) === Number(input.year.slice(0, 4)) + 1, "Choose a consecutive school year for the report.");
    const ids = new Set();
    const subjects = [];
    for (const subject of input.subjects) {
      ensure(subject && typeof subject.id === "string" && subject.id.length > 0 && subject.id.length <= 80 && !ids.has(subject.id), "Subject identifiers must be unique.");
      ids.add(subject.id);
      if (subject.year !== input.year) continue;
      ensure(typeof subject.name === "string" && subject.name.trim().length > 0 && subject.name.length <= 100, "Subject names must contain 1–100 characters.");
      subjects.push({id: subject.id, name: subject.name, grades: []});
    }
    const selected = new Map(subjects.map(subject => [subject.id, subject]));
    input.grades.forEach((grade, order) => {
      const subject = grade && selected.get(grade.subjectId);
      if (!subject) return; // Other school years never enter the workbook.
      ensure(typeof grade.title === "string" && grade.title.trim().length > 0 && grade.title.length <= 120, "Assessment titles must contain 1–120 characters.");
      const parsedDate = typeof grade.date === "string" ? new Date(grade.date + "T00:00:00Z") : new Date(NaN);
      ensure(typeof grade.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(grade.date) && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === grade.date, "Assessment dates must use valid YYYY-MM-DD dates.");
      const earned = numeric(grade.earned, 0, "Points earned");
      const possible = numeric(grade.possible, 0.0001, "Maximum points");
      const weight = numeric(grade.weight, 0.0001, "Weight");
      ensure(earned <= possible, "Points earned cannot exceed maximum points.");
      subject.grades.push({title: grade.title, date: grade.date, dateValue: excelDate(grade.date), earned, possible, weight, score: earned / possible, order});
    });
    subjects.sort((a, b) => a.name.localeCompare(b.name));
    subjects.forEach(subject => subject.grades.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order));
    const generated = input.generatedAt === undefined ? new Date() : new Date(input.generatedAt);
    ensure(Number.isFinite(generated.getTime()), "The report generation date is invalid.");
    return {subjects, year: input.year, generated};
  }
  function worksheet(rows, columns, merges, lastRow, lastCol, frozen, drawing, validations = []) {
    return declaration + `<worksheet xmlns="${NS}" xmlns:r="${REL}"><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${columns.map(([min, max, width, hidden]) => `<col min="${min}" max="${max}" width="${width}" customWidth="1"${hidden ? ' hidden="1"' : ""}/>` ).join("")}</cols><sheetData>${rows.join("")}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : ""}${validations.length ? `<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>` : ""}<printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.45" bottom="0.45" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;CGradebook · Page &amp;P of &amp;N</oddFooter></headerFooter>${drawing ? '<drawing r:id="rId1"/>' : ""}</worksheet>`;
  }
  function cache(values, strings = false, format = "0.0%") {
    return `<c:${strings ? "strCache" : "numCache"}>${strings ? "" : `<c:formatCode>${xml(format)}</c:formatCode>`}<c:ptCount val="${values.length}"/>${values.map((value, index) => value === null ? "" : `<c:pt idx="${index}"><c:v>${xml(value)}</c:v></c:pt>`).join("")}</c:${strings ? "strCache" : "numCache"}>`;
  }
  function title(value) {
    return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1200"><a:latin typeface="Arial"/></a:rPr><a:t>${xml(value)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
  }
  function series(index, name, categoryRange, categories, valueRange, values, color, line) {
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xml(name)}</c:v></c:tx><c:spPr>${line ? `<a:ln w="28575"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>` : `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln>`}</c:spPr>${line ? '<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>' : ""}<c:cat><c:strRef><c:f>${xml(categoryRange)}</c:f>${cache(categories,true)}</c:strRef></c:cat><c:val><c:numRef><c:f>${xml(valueRange)}</c:f>${cache(values)}</c:numRef></c:val>${line ? '<c:smooth val="0"/>' : ""}</c:ser>`;
  }
  function rawChart(chartTitle, data, horizontal) {
    const catAxis = 100001, valueAxis = 100002;
    const plot = horizontal ? `<c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/>${data}<c:gapWidth val="55"/><c:axId val="${catAxis}"/><c:axId val="${valueAxis}"/></c:barChart>` : `<c:lineChart><c:grouping val="standard"/>${data}<c:marker val="1"/><c:axId val="${catAxis}"/><c:axId val="${valueAxis}"/></c:lineChart>`;
    return declaration + `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}"><c:lang val="en-US"/><c:chart>${title(chartTitle)}<c:plotArea><c:layout/>${plot}<c:catAx><c:axId val="${catAxis}"/><c:scaling><c:orientation val="${horizontal ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/><c:tickLblPos val="nextTo"/><c:crossAx val="${valueAxis}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="${valueAxis}"/><c:scaling><c:orientation val="minMax"/><c:max val="1"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "b" : "l"}"/><c:majorGridlines/><c:numFmt formatCode="0%" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="${catAxis}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea>${horizontal ? "" : '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>'}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
  }
  function chart(chartTitle, data, horizontal) {
    const font = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>';
    let result = rawChart(chartTitle,data,horizontal).replace('</c:chartSpace>',font+'</c:chartSpace>');
    if (!horizontal) result = result.replace('<c:plotVisOnly val="1"/>','<c:plotVisOnly val="0"/>');
    return result;
  }
  function drawing(anchors) {
    return declaration + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors.map((anchor, index) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${anchor.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${anchor.endCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.row + anchor.height}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="Chart ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${REL}" r:id="rId${index + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join("")}</xdr:wsDr>`;
  }
  const relationships = entries => declaration + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join("")}</Relationships>`;
  function styles() {
    const formats = [[164,"0.0%"],[165,"yyyy-mm-dd"],[166,'0.00 "pp"'],[167,"0.####"],[168,'yyyy-mm-dd hh:mm "UTC"']];
    const xf = (font, fill, number = 0, wrap = false) => `<xf numFmtId="${number}" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"${wrap ? ' wrapText="1"' : ""}/></xf>`;
    return declaration + `<styleSheet xmlns="${NS}"><numFmts count="5">${formats.map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${xml(code)}"/>`).join("")}</numFmts><fonts count="4"><font><sz val="11"/><color rgb="FF243B53"/><name val="Arial"/></font><font><b/><sz val="16"/><color rgb="FF${NAVY}"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><sz val="11"/><color rgb="FF245F8F"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF${NAVY}"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF3FA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11">${xf(0,0)}${xf(1,0)}${xf(2,2,0,true)}${xf(0,3,0,true)}${xf(0,0,164)}${xf(3,0,165)}${xf(0,0,166)}${xf(3,0,0)}${xf(0,0,168)}${xf(0,0,0,true)}${xf(0,0,0)}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
  const crcTable = Array.from({length: 256}, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
  function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; }
  function zip(files) {
    const local = [], central = []; let offset = 0, centralSize = 0;
    const u16 = (view, at, value) => view.setUint16(at, value, true);
    const u32 = (view, at, value) => view.setUint32(at, value >>> 0, true);
    for (const [filename, content] of files) {
      const name = encoder.encode(filename), data = encoder.encode(content), checksum = crc32(data);
      const header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
      u32(view,0,0x04034b50); u16(view,4,20); u16(view,6,0x0800); u16(view,10,0); u16(view,12,33); u32(view,14,checksum); u32(view,18,data.length); u32(view,22,data.length); u16(view,26,name.length); header.set(name,30);
      local.push(header,data);
      const entry = new Uint8Array(46 + name.length), cv = new DataView(entry.buffer);
      u32(cv,0,0x02014b50); u16(cv,4,20); u16(cv,6,20); u16(cv,8,0x0800); u16(cv,12,0); u16(cv,14,33); u32(cv,16,checksum); u32(cv,20,data.length); u32(cv,24,data.length); u16(cv,28,name.length); u32(cv,42,offset); entry.set(name,46);
      central.push(entry); centralSize += entry.length; offset += header.length + data.length;
    }
    const ending = new Uint8Array(22), ev = new DataView(ending.buffer);
    u32(ev,0,0x06054b50); u16(ev,8,files.length); u16(ev,10,files.length); u32(ev,12,centralSize); u32(ev,16,offset);
    const result = new Uint8Array(offset + centralSize + ending.length); let cursor = 0;
    for (const part of [...local,...central,ending]) { result.set(part,cursor); cursor += part.length; }
    return result;
  }
  function buildReport(input) {
    const {subjects, year, generated} = prepare(input);
    const files = [], charts = [], progressAnchors = [], overviewAnchors = [], validations = [];
    const overview = [row(1,[textCell("A1","Gradebook report",1)],28), row(2,[textCell("A2",`School year ${year}`,3)]), row(3,[textCell("A3","Generated (UTC)"),numberCell("B3",excelDate(generated),8)]), row(4,[textCell("A4","Average change = weighted average − FIRST recorded score, in percentage points. New manual grades count equally. Existing/imported relative weights are kept.",9)],44),row(5,["Subject","Assessments","Weighted average","Latest score","Average change since first (pp)","Latest date"].map((value,index) => textCell(String.fromCharCode(65+index)+"5",value,2)),44)];
    const progress = [row(1,[textCell("A1","Assessment progress",1)],28), row(2,[textCell("A2",`School year ${year}`,3)]),row(3,[textCell("A3","Blue point values are editable inputs; stored weights are shown for reference. New manual grades count equally. Existing/imported relative weights are kept. Same-day records keep their original order. Edits do not synchronize with the app.",9)],48)];
    const progressMerges = ["A1:G1","A2:G2","A3:G3"];
    let progressRow = 5;
    subjects.forEach((subject, subjectIndex) => {
      const overviewRow = subjectIndex + 6, grades = subject.grades;
      if (!grades.length) {
        overview.push(row(overviewRow,[textCell(`A${overviewRow}`,subject.name,9),numberCell(`B${overviewRow}`,0),blankCell(`C${overviewRow}`,4),textCell(`D${overviewRow}`,"No grades"),blankCell(`E${overviewRow}`,6),blankCell(`F${overviewRow}`,5)],Math.max(32,Math.ceil(subject.name.length/24)*15+8)));
        return;
      }
      progress.push(row(progressRow,[textCell(`A${progressRow}`,subject.name,2)],30));
      progressMerges.push(`A${progressRow}:G${progressRow}`);
      const headerRow = progressRow + 1, start = progressRow + 2, end = start + grades.length - 1;
      progress.push(row(headerRow,["Date","Assessment","Earned","Out of","Stored weight","Score","Running average"].map((value,index) => textCell(String.fromCharCode(65+index)+headerRow,value,3)),30));
      let weighted = 0, weight = 0;
      grades.forEach((grade,index) => {
        const current = start + index;
        weighted += grade.score * grade.weight; weight += grade.weight; grade.average = weighted / weight;
        progress.push(row(current,[numberCell(`A${current}`,grade.dateValue,5),textCell(`B${current}`,grade.title,9),numberCell(`C${current}`,grade.earned,7),numberCell(`D${current}`,grade.possible,7),numberCell(`E${current}`,grade.weight,10),numberCell(`F${current}`,grade.score,4,`C${current}/D${current}`),numberCell(`G${current}`,grade.average,4,`SUMPRODUCT(F${start}:F${current},E${start}:E${current})/SUM(E${start}:E${current})`),textFormulaCell(`H${current}`,dateLabel(grade.date),`TEXT(A${current},"dd mmm")`)],Math.max(32,Math.ceil(grade.title.length/34)*15+8)));
      });
      const last = grades[grades.length-1];
      overview.push(row(overviewRow,[textCell(`A${overviewRow}`,subject.name,9),numberCell(`B${overviewRow}`,grades.length),numberCell(`C${overviewRow}`,weighted/weight,4,`'Progress'!G${end}`),numberCell(`D${overviewRow}`,last.score,4,`'Progress'!F${end}`),numberCell(`E${overviewRow}`,(weighted/weight-grades[0].score)*100,6,`(C${overviewRow}-'Progress'!F${start})*100`),numberCell(`F${overviewRow}`,last.dateValue,5,`'Progress'!A${end}`)],Math.max(32,Math.ceil(subject.name.length/24)*15+8)));
      for (const [column,low,high] of [["C","0",`D${start}`],["D","0.0001","999999"]]) validations.push(`<dataValidation type="decimal" operator="between" allowBlank="0" showInputMessage="1" showErrorMessage="1" errorStyle="stop" errorTitle="Invalid grade input" error="Use valid points and a positive maximum." promptTitle="Editable grade input" prompt="Earned points must be between zero and maximum points. Maximum points must be positive." sqref="${column}${start}:${column}${end}"><formula1>${low}</formula1><formula2>${high}</formula2></dataValidation>`);
      const categories = grades.map(grade => dateLabel(grade.date));
      const data = series(0,"Assessment score",range("Progress","H",start,end),categories,range("Progress","F",start,end),grades.map(grade=>grade.score),GLACIER,true) + series(1,"Running weighted average",range("Progress","H",start,end),categories,range("Progress","G",start,end),grades.map(grade=>grade.average),BLUE,true);
      charts.push(chart(`${subject.name} · progress`,data,false)); progressAnchors.push({col:0,endCol:7,row:end+1,height:17,chart:charts.length});
      progressRow = end + 21;
    });
    if (subjects.some(subject=>subject.grades.length)) {
      const data = series(0,"Weighted average",range("Overview","A",6,subjects.length+5),subjects.map(subject=>subject.name),range("Overview","C",6,subjects.length+5),subjects.map(subject=>subject.grades.length ? subject.grades[subject.grades.length-1].average : null),BLUE,false);
      charts.push(chart("Subject weighted averages",data,true)); overviewAnchors.push({col:0,endCol:6,row:subjects.length+7,height:Math.max(18,Math.ceil(subjects.length*1.25)+5),chart:charts.length});
    }
    if (!subjects.length) overview.push(row(6,[textCell("A6","No subjects in this school year.",9)],30));
    if (!progressAnchors.length) progress.push(row(5,[textCell("A5","No recorded grades in this school year.",9)],30));
    const overviewLast = Math.max(subjects.length+6,...overviewAnchors.map(anchor=>anchor.row+anchor.height+1)), progressLast = Math.max(5,progressRow-1);
    files.push(["xl/worksheets/sheet1.xml",worksheet(overview,[[1,1,31],[2,2,13],[3,4,19],[5,5,25],[6,6,16]],["A1:F1","A2:F2","B3:D3","A4:F4"],overviewLast,"F",5,overviewAnchors.length)]);
    files.push(["xl/worksheets/sheet2.xml",worksheet(progress,[[1,1,14],[2,2,43],[3,5,13],[6,7,19],[8,8,14,true]],progressMerges,progressLast,"H",3,progressAnchors.length,validations)]);
    [overviewAnchors,progressAnchors].forEach((anchors,index) => {
      if (!anchors.length) return;
      files.push([`xl/drawings/drawing${index+1}.xml`,drawing(anchors)]);
      files.push([`xl/drawings/_rels/drawing${index+1}.xml.rels`,relationships(anchors.map((anchor,item)=>[`rId${item+1}`,"chart",`../charts/chart${anchor.chart}.xml`]))]);
      files.push([`xl/worksheets/_rels/sheet${index+1}.xml.rels`,relationships([["rId1","drawing",`../drawings/drawing${index+1}.xml`]])]);
    });
    charts.forEach((content,index)=>files.push([`xl/charts/chart${index+1}.xml`,content]));
    files.push(["xl/styles.xml",styles()]);
    files.push(["xl/workbook.xml",declaration+`<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="Progress" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'Overview'!$A$1:$F$${overviewLast}</definedName><definedName name="_xlnm.Print_Area" localSheetId="1">'Progress'!$A$1:$G$${progressLast}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'Overview'!$1:$5</definedName><definedName name="_xlnm.Print_Titles" localSheetId="1">'Progress'!$1:$3</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/></workbook>`]);
    files.push(["xl/_rels/workbook.xml.rels",relationships([["rId1","worksheet","worksheets/sheet1.xml"],["rId2","worksheet","worksheets/sheet2.xml"],["rId3","styles","styles.xml"]])]);
    files.push(["_rels/.rels",relationships([["rId1","officeDocument","xl/workbook.xml"]])]);
    const types = [["/xl/workbook.xml","spreadsheetml.sheet.main"],["/xl/styles.xml","spreadsheetml.styles"],["/xl/worksheets/sheet1.xml","spreadsheetml.worksheet"],["/xl/worksheets/sheet2.xml","spreadsheetml.worksheet"]];
    files.push(["[Content_Types].xml",declaration+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${types.map(([part,type])=>`<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`).join("")}${[overviewAnchors,progressAnchors].map((anchors,index)=>anchors.length?`<Override PartName="/xl/drawings/drawing${index+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`:"").join("")}${charts.map((_,index)=>`<Override PartName="/xl/charts/chart${index+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("")}</Types>`]);
    return zip(files);
  }
  return {buildReport};
});
