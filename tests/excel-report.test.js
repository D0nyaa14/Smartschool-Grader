"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {buildReport} = require("../guest-site/assets/excel-report.js");

function crc(bytes) {
  let value = -1;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ -1) >>> 0;
}
// Read ZIP independently of the writer, verifying central/local headers and CRC.
function unpack(bytes) {
  assert.ok(bytes instanceof Uint8Array);
  const data = Buffer.from(bytes);
  const end = data.length - 22;
  assert.equal(data.readUInt32LE(end), 0x06054b50);
  const count = data.readUInt16LE(end + 10);
  let offset = data.readUInt32LE(end + 16);
  const files = new Map();
  for (let item = 0; item < count; item++) {
    assert.equal(data.readUInt32LE(offset), 0x02014b50);
    assert.equal(data.readUInt16LE(offset + 10), 0); // Stored, no external inflater.
    const size = data.readUInt32LE(offset + 24);
    const length = data.readUInt16LE(offset + 28);
    const name = data.subarray(offset + 46, offset + 46 + length).toString("utf8");
    assert.ok(!name.includes("..") && !name.startsWith("/"));
    assert.ok(!files.has(name));
    const local = data.readUInt32LE(offset + 42);
    assert.equal(data.readUInt32LE(local), 0x04034b50);
    assert.equal(data.readUInt32LE(local + 22), size);
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const contents = data.subarray(start,start + size);
    assert.equal(crc(contents), data.readUInt32LE(offset + 16));
    files.set(name, contents.toString("utf8"));
    offset += 46 + length + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32);
  }
  assert.equal(offset,end);
  return files;
}
function fixture() {
  return {
    year: "2026-2027", generatedAt: new Date("2026-10-17T12:00:00Z"),
    subjects: [{id:"a",name:"Alpha mathematics",year:"2026-2027"},{id:"empty",name:"Beta no grades",year:"2026-2027"},{id:"private",name:"Other-year private subject",year:"2025-2026"}],
    grades: [
      {subjectId:"a",title:"Latest exam",earned:9,possible:10,weight:3,date:"2026-10-12"},
      {subjectId:"a",title:"First quiz",earned:16,possible:20,weight:1,date:"2026-10-01"},
      {subjectId:"private",title:"Other-year private assessment",earned:3,possible:10,weight:1,date:"2026-10-01"},
    ],
  };
}
const decode = value => value.replace(/&apos;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&");
function cell(sheet, reference) {
  const content = sheet.match(new RegExp(`<c r="${reference}"[^>]*>(.*?)</c>`));
  assert.ok(content, "Missing cell " + reference);
  return {formula: content[1].includes("<f>") ? decode(content[1].match(/<f>(.*?)<\/f>/)[1]) : null,value:Number(content[1].match(/<v>(.*?)<\/v>/)?.[1]), xml:content[0]};
}

test("ZIP is valid with exactly two named sheets, styles, native drawings and chart relationships", () => {
  const files = unpack(buildReport(fixture()));
  const workbook = files.get("xl/workbook.xml");
  assert.equal((workbook.match(/<sheet name=/g) || []).length,2);
  assert.match(workbook,/name="Overview"/); assert.match(workbook,/name="Progress"/);
  assert.match(workbook,/fullCalcOnLoad="1"/);
  assert.ok(files.has("xl/charts/chart1.xml") && files.has("xl/charts/chart2.xml"));
  assert.match(files.get("xl/drawings/_rels/drawing2.xml.rels"),/Target="\.\.\/charts\/chart1.xml"/);
  assert.match(files.get("[Content_Types].xml"),/drawingml.chart\+xml/);
  assert.match(files.get("xl/styles.xml"),/Arial/);
  assert.match(files.get("xl/styles.xml"),/formatCode="0.0%"/);
});

test("winter-blue report palette matches the app without changing chart meaning", () => {
  const files=unpack(buildReport(fixture()));
  const styles=files.get("xl/styles.xml");
  assert.match(styles,/FF173B57/);assert.match(styles,/FFEAF3FA/);assert.match(styles,/FF243B53/);
  const line=files.get("xl/charts/chart1.xml"), bar=files.get("xl/charts/chart2.xml");
  assert.match(line,/<a:srgbClr val="8FC4E3"\/>/);
  assert.match(line,/<a:srgbClr val="245F8F"\/>/);
  assert.match(bar,/<a:srgbClr val="245F8F"\/>/);
  assert.doesNotMatch(styles+line+bar,/174D3C|8DBAA4|EAF2ED/);
});

test("weighted totals, first-to-average change, formulas and cached values agree", () => {
  const files = unpack(buildReport(fixture()));
  const overview = files.get("xl/worksheets/sheet1.xml"), progress = files.get("xl/worksheets/sheet2.xml");
  assert.equal(cell(progress,"F7").formula,"C7/D7");
  assert.equal(cell(progress,"F7").value,0.8);
  assert.equal(cell(progress,"G8").formula,"SUMPRODUCT(F7:F8,E7:E8)/SUM(E7:E8)");
  assert.equal(cell(progress,"G8").value,0.875);
  assert.equal(cell(overview,"C6").formula,"'Progress'!G8");
  assert.equal(cell(overview,"C6").value,0.875);
  assert.equal(cell(overview,"D6").value,0.9);
  assert.equal(cell(overview,"E6").formula,"(C6-'Progress'!F7)*100");
  assert.ok(Math.abs(cell(overview,"E6").value-7.5)<1e-12);
  assert.match(overview,/Average change since first \(pp\)/);
  assert.match(overview,/<c r="C7" s="4"\/>/); assert.match(overview,/No grades/);
});

test("year selection scopes records by subject year and never leaks another year or identity", () => {
  const input = fixture(); input.studentName="DO NOT EXPORT REAL NAME";
  input.grades[1].date="2024-02-01"; // Preserve assigned-year records even with unusual calendar dates.
  const all = [...unpack(buildReport(input)).values()].join("");
  assert.doesNotMatch(all,/Other-year private|DO NOT EXPORT REAL NAME/);
  assert.match(all,/First quiz/);
});

test("chronological ordering is stable for same-day grades and keeps zero, single points and date serials", () => {
  const input=fixture();
  input.grades=[{subjectId:"a",title:"Same day first",earned:0,possible:10,weight:1,date:"2026-10-01"},{subjectId:"a",title:"Same day second",earned:10,possible:10,weight:1,date:"2026-10-01"}];
  const files=unpack(buildReport(input)); const progress=files.get("xl/worksheets/sheet2.xml");
  assert.ok(progress.indexOf("Same day first")<progress.indexOf("Same day second"));
  assert.equal(cell(progress,"F7").value,0); assert.equal(cell(progress,"G8").value,0.5);
  assert.equal(cell(progress,"A7").value,(Date.UTC(2026,9,1)-Date.UTC(1899,11,30))/86400000);
  assert.match(files.get("xl/charts/chart1.xml"),/<c:pt idx="0"><c:v>0<\/c:v>/);
  input.grades.length=1;
  const single=unpack(buildReport(input));
  assert.equal(cell(single.get("xl/worksheets/sheet1.xml"),"C6").value,0);
  assert.match(single.get("xl/charts/chart1.xml"),/&apos;Progress&apos;!\$F\$7:\$F\$7/);
});

test("native chart ranges use formula-backed short date labels, score and running formulas with fixed percentage axes", () => {
  const files=unpack(buildReport(fixture()));
  const line=files.get("xl/charts/chart1.xml"), bar=files.get("xl/charts/chart2.xml");
  assert.match(line,/<c:cat><c:strRef><c:f>&apos;Progress&apos;!\$H\$7:\$H\$8<\/c:f>/);
  assert.match(line,/01 Oct/); assert.match(line,/12 Oct/);
  assert.match(line,/plotVisOnly val="0"/); assert.match(line,/\$F\$7:\$F\$8/); assert.match(line,/\$G\$7:\$G\$8/);
  const progress=files.get("xl/worksheets/sheet2.xml");
  assert.match(progress,/<col min="8" max="8" width="14" customWidth="1" hidden="1"\/>/);
  assert.match(progress,/<c r="H7" t="str"><f>TEXT\(A7,&quot;dd mmm&quot;\)<\/f><v>01 Oct<\/v>/);
  assert.match(bar,/<c:barDir val="bar"\/>/); assert.match(bar,/\$C\$6:\$C\$7/);
  for(const chart of [line,bar]) {assert.match(chart,/<c:max val="1"\/>/);assert.match(chart,/<c:min val="0"\/>/);assert.match(chart,/Arial/);}
});

test("charts sit below tables within readable widths and progress freezes only global headings", () => {
  const files=unpack(buildReport(fixture()));
  assert.match(files.get("xl/worksheets/sheet1.xml"),/showGridLines="0"/);
  assert.match(files.get("xl/worksheets/sheet2.xml"),/ySplit="3" topLeftCell="A4"/);
  assert.match(files.get("xl/drawings/drawing1.xml"),/<xdr:col>6<\/xdr:col>/);
  assert.match(files.get("xl/drawings/drawing2.xml"),/<xdr:col>7<\/xdr:col>/);
  assert.match(files.get("xl/drawings/drawing2.xml"),/<xdr:row>9<\/xdr:row>/);
  const input=fixture();input.subjects=Array.from({length:30},(_,i)=>({id:String(i),name:"Subject "+i,year:input.year}));input.grades=input.subjects.map(subject=>({...fixture().grades[0],subjectId:subject.id}));
  const many=unpack(buildReport(input));
  const anchor=many.get("xl/drawings/drawing1.xml");
  const rows=[...anchor.matchAll(/<xdr:row>(\d+)<\/xdr:row>/g)].map(match=>Number(match[1]));
  assert.ok(rows[1]-rows[0]>=40);
});

test("point inputs get stop validation and stored weight remains informational", () => {
  const files=unpack(buildReport(fixture()));
  const progress=files.get("xl/worksheets/sheet2.xml");
  assert.match(progress,/dataValidations count="2"/); assert.match(progress,/errorStyle="stop"/);
  assert.match(progress,/sqref="C7:C8"/);assert.match(progress,/<formula2>D7<\/formula2>/);
  assert.match(progress,/sqref="D7:D8"/);assert.doesNotMatch(progress,/sqref="E7:E8"/);
  assert.match(progress,/<c r="E7" s="10">/);assert.match(progress,/Stored weight/);
  assert.match(progress,/New manual grades count equally/);
  const styles=[...files.get("xl/styles.xml").match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/)[1].matchAll(/<xf [^>]*>/g)].map(match=>match[0]);
  assert.match(styles[7],/numFmtId="0"/); // General preserves 0.0001 and avoids trailing decimal points.
  assert.match(styles[10],/numFmtId="0"/);
});

test("empty reports and empty subjects produce no empty charts or fake zero averages", () => {
  const input=fixture();input.grades=[];
  const files=unpack(buildReport(input));
  assert.ok(![...files.keys()].some(name=>name.startsWith("xl/charts/")));
  assert.match(files.get("xl/worksheets/sheet2.xml"),/No recorded grades/);
  input.subjects=[];
  assert.match(unpack(buildReport(input)).get("xl/worksheets/sheet1.xml"),/No subjects/);
});

test("untrusted labels are literal strings, XML escaped and invalid controls removed", () => {
  const input=fixture();input.subjects[0].name='=HYPERLINK("https://evil.test","<bad&>")\u0001😀';input.grades[0].title="@SUM(1)\u0000\ud800";
  const files=unpack(buildReport(input));const all=[...files.values()].join("");
  assert.match(all,/&lt;bad&amp;&gt;/);assert.match(all,/😀/);assert.doesNotMatch(all,/[\u0000\u0001\ud800]/);
  assert.match(files.get("xl/worksheets/sheet1.xml"),/t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/);
  assert.doesNotMatch(all,/<hyperlinks|<externalLinks|TargetMode="External"|vbaProject/);
  for (const match of all.matchAll(/<f>(.*?)<\/f>/g)) assert.doesNotMatch(match[1],/HYPERLINK|SUM\(1\)/);
});

test("invalid values, sizes, date ranges and malformed years fail with useful errors", () => {
  for(const [field,value] of [["earned",NaN],["earned",Infinity],["earned",-1],["earned",11],["earned",0.12345],["weight",0],["possible",0],["date","2026-02-30"],["date","1899-12-31"]]) {
    const input=fixture(); input.grades[0][field]=value;assert.throws(()=>buildReport(input));
  }
  const input=fixture();input.year="2026-2028";assert.throws(()=>buildReport(input),/consecutive/);
  input.year="2026-2027";input.grades=Array(5001).fill(input.grades[0]);assert.throws(()=>buildReport(input),/5000/);
});

test("independent weighted calculation matches all running formula caches without changing caller input", () => {
  const input=fixture();input.subjects=input.subjects.slice(0,1);
  input.grades=Array.from({length:40},(_,index)=>({subjectId:"a",title:"Assessment "+index,earned:index%11,possible:10,weight:1+index%4,date:"2026-10-01"}));
  const before=JSON.stringify(input);const progress=unpack(buildReport(input)).get("xl/worksheets/sheet2.xml");
  let weights=0,weighted=0;
  input.grades.forEach((grade,index)=>{weights+=grade.weight;weighted+=grade.earned*grade.weight/grade.possible;assert.ok(Math.abs(cell(progress,"G"+(index+7)).value-weighted/weights)<1e-12);});
  assert.equal(JSON.stringify(input),before);
});
