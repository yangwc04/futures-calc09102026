/* data:import - 엑셀 원본에서 JSON·CSV 재생성 (무의존성, node만 필요)
   실행: node tools/import.cjs [xlsx경로] [--check]
   --check: 파일에 쓰지 않고 커밋된 데이터와 의미 비교 후不一致 시 exit 1
   legacy_specs_raw.json은 원본 스냅샷이라 생성하지 않음 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

function readZip(buf) {
  let off = 0; const files = {};
  while (off < buf.length - 4) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const method = buf.readUInt16LE(off + 8);
    const csize = buf.readUInt32LE(off + 18);
    const nlen = buf.readUInt16LE(off + 26);
    const elen = buf.readUInt16LE(off + 28);
    const name = buf.toString("utf8", off + 30, off + 30 + nlen);
    const start = off + 30 + nlen + elen;
    files[name] = method === 8 ? zlib.inflateRawSync(buf.slice(start, start + csize)) : buf.slice(start, start + csize);
    off = start + csize;
  }
  return files;
}
function unesc(s) {
  let p = String(s), n = "";
  for (let i = 0; i < 3 && p !== n; i++) {
    n = p;
    p = p.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }
  return p;
}
function colIdx(ref) {
  const m = ref.match(/^([A-Z]+)/); let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function loadSheets(xlsxPath) {
  const files = readZip(fs.readFileSync(xlsxPath));
  const wb = files["xl/workbook.xml"].toString("utf8");
  const rmap = {};
  for (const rm of files["xl/_rels/workbook.xml.rels"].toString("utf8").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = (rm[0].match(/Id="([^"]+)"/) || [])[1];
    const tg = (rm[0].match(/Target="([^"]+)"/) || [])[1];
    if (id && tg) rmap[id] = tg.replace(/^(\.\.\/|\/)+/, "");
  }
  const out = {};
  const re = /<(?:x:)?sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"|<(?:x:)?sheet\b[^>]*r:id="([^"]+)"[^>]*name="([^"]+)"/g;
  let m;
  while ((m = re.exec(wb))) {
    const name = m[1] || m[4], rid = m[2] || m[3];
    const key = rmap[rid];
    if (!files[key]) throw new Error("sheet file missing: " + name);
    out[name] = parseSheet(files[key].toString("utf8").replace(/<(\/?)x:/g, "<$1"));
  }
  return out;
}
function parseSheet(xml) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    const cellRe = /<c\s+r="([A-Z]+\d+)"([^>]*?)\/>|<c\s+r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const selfClose = cm[1] !== undefined;
      const ref = selfClose ? cm[1] : cm[3], attrs = selfClose ? cm[2] : cm[4], inner = selfClose ? "" : cm[5];
      const t = (attrs.match(/t="([a-zA-Z]+)"/) || [])[1] || "";
      const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
      const im = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
      let v;
      if (t === "b") v = (vm ? vm[1] : "") === "1";
      else if (t === "e") v = "";
      else if (im) v = unesc(im[1]);
      else if (t === "str" || t === "inlineStr") v = unesc(vm ? vm[1] : "");
      else if (!vm) v = "";
      else { const n = Number(vm[1]); v = Number.isFinite(n) ? n : unesc(vm[1]); }
      cells[colIdx(ref)] = v;
    }
    rows.push(cells);
  }
  return rows;
}
/* 값 정규화 */
const MISSING = Symbol("missing");
function cell(row, i) { return i in row ? row[i] : MISSING; }
function asStr(v) {
  if (v === MISSING || v === "" || v == null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
function asNum(v) {
  if (v === MISSING || v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("숫자 변환 실패: " + JSON.stringify(v));
  return n;
}
function asBool(v) {
  if (v === true || v === 1 || v === "TRUE" || v === "true") return true;
  return false;
}
function asDate(v) {
  if (v === MISSING || v === "" || v == null) return "";
  if (typeof v === "number") {
    if (v > 20000 && v < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return d.toISOString().slice(0, 10);
    }
    throw new Error("날짜 변환 실패: " + v);
  }
  return String(v);
}
function rowsToObjects(rows) {
  const head = rows[0].map(h => String(h == null ? "" : h));
  return rows.slice(1).map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = i in r ? r[i] : MISSING; });
    return o;
  });
}

function buildCatalog(sheets) {
  const recs = rowsToObjects(sheets.Instruments).map(r => ({
    id: asStr(r.id), name_ko: asStr(r.name_ko), name_en: asStr(r.name_en),
    asset_class: asStr(r.asset_class), subcategory: asStr(r.subcategory),
    family_id: asStr(r.family_id), venue_code: asStr(r.venue_code),
    underlying_symbol: asStr(r.underlying_symbol), trading_class: asStr(r.trading_class),
    currency: asStr(r.currency), size_tier: asStr(r.size_tier),
    record_type: asStr(r.record_type), quality_status: asStr(r.quality_status),
    classification_basis: asStr(r.classification_basis), featured: asBool(r.featured),
    search_keywords: asStr(r.search_keywords), source_id: asStr(r.source_id),
    enrichment_source_id: asStr(r.enrichment_source_id), as_of_date: asDate(r.as_of_date),
    alias_of: asStr(r.alias_of), notes_ko: asStr(r.notes_ko)
  }));
  const taxonomy = rowsToObjects(sheets.Taxonomy).map(r => ({
    asset_class: asStr(r.asset_class), asset_class_ko: asStr(r.asset_class_ko),
    subcategory: asStr(r.subcategory), subcategory_ko: asStr(r.subcategory_ko),
    class_order: asNum(r.class_order), subcategory_order: asNum(r.subcategory_order),
    keywords: asStr(r.keywords)
  }));
  const venues = rowsToObjects(sheets.Venues).map(r => ({
    venue_code: asStr(r.venue_code), display_name: asStr(r.display_name),
    record_type: asStr(r.record_type), notes: asStr(r.notes)
  }));
  const sources = rowsToObjects(sheets.Sources).map(r => ({
    source_id: asStr(r.source_id), title: asStr(r.title), url: asStr(r.url),
    kind: asStr(r.kind), as_of_date: asDate(r.as_of_date), notes: asStr(r.notes)
  }));
  const schema = rowsToObjects(sheets.Schema).map(r => ({
    field: asStr(r.field), type: asStr(r.type), required: asStr(r.required),
    description_ko: asStr(r.description_ko), example: asStr(r.example)
  }));
  // 참조 무결성
  const subSet = new Set(taxonomy.map(t => t.subcategory));
  const venSet = new Set(venues.map(v => v.venue_code));
  const srcSet = new Set(sources.map(s => s.source_id));
  const idSet = new Set(recs.map(r => r.id));
  if (idSet.size !== recs.length) throw new Error("id 중복");
  recs.forEach(r => {
    if (!subSet.has(r.subcategory)) throw new Error("subcategory FK 위반: " + r.id);
    if (!venSet.has(r.venue_code)) throw new Error("venue FK 위반: " + r.id);
    if (!srcSet.has(r.source_id)) throw new Error("source FK 위반: " + r.id);
    if (r.alias_of && !idSet.has(r.alias_of)) throw new Error("alias FK 위반: " + r.id);
    if (typeof r.featured !== "boolean") throw new Error("featured 타입 위반: " + r.id);
  });
  // 통계 (첫 등장 순서 유지)
  const cnt = {};
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const rt = {}, qs = {}, ac = {};
  recs.forEach(r => { bump(rt, r.record_type); bump(qs, r.quality_status); bump(ac, r.asset_class); });
  const stats = {
    total: recs.length,
    venue_labels: new Set(recs.map(r => r.venue_code)).size,
    asset_classes: new Set(recs.map(r => r.asset_class)).size,
    subcategories: new Set(recs.map(r => r.subcategory)).size,
    featured: recs.filter(r => r.featured).length,
    record_type: rt, quality_status: qs, asset_class: ac
  };
  void cnt;
  return {
    schema_version: "1.0", records: recs, taxonomy, venues, sources, schema, stats
  };
}

function buildMap(sheets) {
  return rowsToObjects(sheets.CalculatorMap).map(r => {
    const rawId = r.instrument_id === MISSING ? "" : asStr(r.instrument_id);
    let instrument_id = rawId;
    if (instrument_id === "" || instrument_id === "unmatched" || instrument_id === "custom_input") instrument_id = null;
    let mapping_status = r.mapping_status === MISSING ? "" : asStr(r.mapping_status);
    if (!mapping_status) {
      if (rawId === "unmatched") mapping_status = "unmatched";
      else if (rawId === "custom_input") mapping_status = "custom_input";
      else throw new Error("mapping_status 비어있음: " + r.legacy_code);
    }
    let pv = r.legacy_point_value;
    if (pv === MISSING || pv === "" || pv === "user_input") pv = null;
    else { pv = asNum(pv); }
    const tick = (r.legacy_tick_size === MISSING || r.legacy_tick_size === "") ? null : asNum(r.legacy_tick_size);
    const quote = (r.legacy_quote_symbol === MISSING || r.legacy_quote_symbol === "") ? null : asStr(r.legacy_quote_symbol);
    let spec = (r.spec_status === MISSING || r.spec_status === "") ? null : asStr(r.spec_status);
    if (!spec && r.legacy_code === "CUSTOM") spec = "user_input";
    if (!spec) throw new Error("spec_status 비어있음: " + r.legacy_code);
    let scale = (r.quote_to_calc_scale === MISSING || r.quote_to_calc_scale === "") ? null : asNum(r.quote_to_calc_scale);
    if (scale === 0) scale = null;
    return {
      legacy_code: asStr(r.legacy_code), legacy_name: asStr(r.legacy_name), legacy_venue: asStr(r.legacy_venue),
      instrument_id, mapping_status, legacy_point_value: pv, legacy_tick_size: tick,
      legacy_quote_symbol: quote, spec_status: spec,
      quote_status: asStr(r.quote_status),
      quote_to_calc_scale: scale, auto_fill_quote_allowed: asBool(r.auto_fill_quote_allowed),
      source_url: asStr(r.source_url), captured_on: asDate(r.captured_on), notes_ko: asStr(r.notes_ko)
    };
  });
}

function buildIssues(sheets) {
  return rowsToObjects(sheets.IntegrationIssues).map(r => ({
    issue_id: asStr(r.issue_id), codes: asStr(r.codes),
    finding_ko: asStr(r.finding_ko), action_ko: asStr(r.action_ko),
    source_url: asStr(r.source_url), status: asStr(r.status)
  }));
}
function buildProfiles(sheets) {
  return rowsToObjects(sheets.ReferenceProfiles).map(r => ({
    profile_id: asStr(r.profile_id), instrument_id: asStr(r.instrument_id),
    input_price_unit: asStr(r.input_price_unit),
    point_value: asNum(r.point_value), tick_size: asNum(r.tick_size),
    settlement_currency: asStr(r.settlement_currency),
    quote_to_calc_scale: (r.quote_to_calc_scale === MISSING || r.quote_to_calc_scale === "") ? null : asNum(r.quote_to_calc_scale),
    scope: asStr(r.scope), source_url: asStr(r.source_url),
    verified_on: asDate(r.verified_on), notes_ko: asStr(r.notes_ko)
  }));
}

function csvCell(v) {
  const s = v == null ? "" : (typeof v === "boolean" ? (v ? "true" : "false") : String(v));
  return '"' + s.replace(/"/g, '""') + '"';
}
function toCSV(rows, cols) {
  const lines = [cols.map(csvCell).join(",")];
  rows.forEach(r => lines.push(cols.map(c => csvCell(r[c])).join(",")));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
function json2(o) { return JSON.stringify(o, null, 2) + "\n"; }
function calcmapJs(mapRows) {
  let o = "/* GENERATED - do not edit. Regenerate with tools/import.cjs. */\nwindow.CALCMAP={\n";
  for (const m of mapRows) {
    o += JSON.stringify(m.legacy_code) + ":{id:" + (m.instrument_id ? JSON.stringify(m.instrument_id) : "null") +
      ",spec:" + JSON.stringify(m.spec_status) + ",qs:" + JSON.stringify(m.quote_status) +
      ",src:" + JSON.stringify(m.source_url || null) + ",on:" + JSON.stringify(m.captured_on || null) +
      ",scale:" + (m.quote_to_calc_scale == null ? "null" : m.quote_to_calc_scale) +
      ",af:" + (m.auto_fill_quote_allowed ? "true" : "false") + "},\n";
  }
  return o + "};\n";
}

function deepEqual(a, b, path) {
  if (a === b) return null;
  if (typeof a !== typeof b) return path + " 타입 다름";
  if (a && b && typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return path + " 배열 다름";
    if (Array.isArray(a)) {
      if (a.length !== b.length) return path + " 길이 " + a.length + " vs " + b.length;
      for (let i = 0; i < a.length; i++) {
        const d = deepEqual(a[i], b[i], path + "[" + i + "]");
        if (d) return d;
      }
      return null;
    }
    const ka = Object.keys(a), kb = new Set(Object.keys(b));
    for (const k of ka) {
      if (!kb.has(k)) return path + " 키 없음: " + k;
      const d = deepEqual(a[k], b[k], path + "." + k);
      if (d) return d;
    }
    for (const k of Object.keys(b)) if (!(k in a)) return path + " 추가 키: " + k;
    return null;
  }
  if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-12) return null;
  return path + " 값 다름: " + JSON.stringify(a) + " vs " + JSON.stringify(b);
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const xlsxArg = args.find(a => !a.startsWith("--"));
  const repoRoot = path.join(__dirname, "..");
  const xlsx = xlsxArg || path.join(repoRoot, "data-source", "IBKR_선물코드_공개목록_2026-09-24.xlsx");
  const outDir = check ? fs.mkdtempSync(path.join(os.tmpdir(), "import-")) : path.join(repoRoot, "data");
  const sheets = loadSheets(xlsx);
  for (const s of ["Instruments", "Taxonomy", "Venues", "Sources", "Schema", "CalculatorMap", "IntegrationIssues", "ReferenceProfiles"]) {
    if (!sheets[s]) throw new Error("시트 없음: " + s);
  }
  const catalog = buildCatalog(sheets);
  const mapRows = buildMap(sheets);
  const issues = buildIssues(sheets);
  const profiles = buildProfiles(sheets);
  const instCols = ["id", "name_ko", "name_en", "asset_class", "subcategory", "family_id", "venue_code", "underlying_symbol", "trading_class", "currency", "size_tier", "record_type", "quality_status", "classification_basis", "featured", "search_keywords", "source_id", "enrichment_source_id", "as_of_date", "alias_of", "notes_ko"];
  const mapCols = ["legacy_code", "legacy_name", "legacy_venue", "instrument_id", "mapping_status", "legacy_point_value", "legacy_tick_size", "legacy_quote_symbol", "spec_status", "quote_status", "quote_to_calc_scale", "auto_fill_quote_allowed", "source_url", "captured_on", "notes_ko"];
  const files = {
    "catalog.json": json2(catalog),
    "instruments.csv": toCSV(catalog.records, instCols),
    "calculator_map.json": json2(mapRows),
    "calculator_map.csv": toCSV(mapRows, mapCols),
    "integration_issues.json": json2(issues),
    "reference_profiles.json": json2(profiles),
    "calcmap.js": calcmapJs(mapRows)
  };
  if (check) {
    let bad = 0;
    for (const [name, content] of Object.entries(files)) {
      const cur = fs.readFileSync(path.join(repoRoot, "data", name), "utf8");
      let d;
      if (name.endsWith(".json")) d = deepEqual(JSON.parse(content), JSON.parse(cur), name);
      else d = (content === cur) ? null : (name + " 바이트不一致 (" + content.length + " vs " + cur.length + ")");
      if (d) { bad++; console.log("DIFF " + d); }
      else console.log("SAME " + name);
    }
    if (bad) { console.log("불일치 " + bad + "개"); process.exit(1); }
    console.log("전체 일치: 재생성 결과 동일");
    return;
  }
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(outDir, name), content);
  }
  console.log("생성 완료: " + Object.keys(files).join(", "));
}
main();
