/* Phase 1 테스트: 데이터 정합 + 검색 로직 (node tools/test-explorer.cjs) */
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("../js/explorer.js");

const ROOT = path.join(__dirname, "..");
const PKG = "C:/Users/yangw/Dropbox/Woochul Yang/AI/Opencode/Muse spark/계산 프로그램/IBKR_선물계산기_RAW패키지/futures_calc_raw/data";
const J = f => JSON.parse(fs.readFileSync(f, "utf8"));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}

const cat = J(path.join(ROOT, "data", "catalog.json"));
const map = J(path.join(ROOT, "data", "calculator_map.json"));
const issues = J(path.join(ROOT, "data", "integration_issues.json"));
const ref = J(path.join(ROOT, "data", "reference_profiles.json"));

// 1. 수량
ok(cat.records.length === 717, "catalog 717행", cat.records.length);
const types = {};
cat.records.forEach(r => { types[r.record_type] = (types[r.record_type] || 0) + 1; });
ok(types.exchange_product === 703 && types.otc_product === 5 && types.routing_alias === 9, "행 종류 703/5/9", JSON.stringify(types));
ok(cat.records.filter(r => r.featured === true).length === 34, "featured 34개");
ok(cat.taxonomy.length === 39, "세부분류 39");
ok(cat.venues.length === 34, "거래소 표기 34");
ok(map.length === 58, "연결표 58행");
const mst = {};
map.forEach(m => { mst[m.mapping_status] = (mst[m.mapping_status] || 0) + 1; });
ok(mst.venue_code_match === 49 && mst.editorial_venue_alias === 6 && mst.editorial_product_alias === 1 && mst.unmatched === 1 && mst.custom_input === 1, "연결 상태 49/6/1/1/1", JSON.stringify(mst));
ok(Array.isArray(issues) && issues.length === 7, "integration_issues 7항");
ok(issues.every(i => i.issue_id && i.codes && i.finding_ko && i.action_ko && i.status), "issues 필수키");

// 2. 무결성
const ids = new Set(cat.records.map(r => r.id));
ok(ids.size === 717, "id 고유");
const subs = new Set(cat.taxonomy.map(t => t.subcategory));
ok(cat.records.every(r => subs.has(r.subcategory)), "subcategory FK");
const vens = new Set(cat.venues.map(v => v.venue_code));
ok(cat.records.every(r => vens.has(r.venue_code)), "venue FK");
const srcs = new Set(cat.sources.map(s => s.source_id));
ok(cat.records.every(r => r.source_id && srcs.has(r.source_id)), "source FK");
ok(cat.records.every(r => !r.alias_of || ids.has(r.alias_of)), "alias_of FK");
ok(cat.records.every(r => typeof r.featured === "boolean"), "featured boolean 타입");
const zc = ref.find(p => p.instrument_id === "ibkr:CBOT:ZC");
ok(zc && zc.point_value === 50 && zc.tick_size === 0.25 && zc.quote_to_calc_scale === null, "ZC 참조 프로필");

// CSV 앞자리 0 보존
const csvRaw = fs.readFileSync(path.join(PKG, "instruments.csv"), "utf8");
const zeroIds = cat.records.map(r => r.id).filter(id => /:[0-9]/.test(id));
ok(zeroIds.length > 0 && zeroIds.every(id => csvRaw.includes(id)), "CSV 앞자리0 보존", "예: " + zeroIds.slice(0, 3).join(","));

// 3. 검색
const byId = id => cat.records.find(r => r.id === id);
const gc = byId("ibkr:COMEX:GC"), zn = byId("ibkr:CBOT:ZN");
const resGold = L.search(cat.records, "금").map(r => r.id);
ok(resGold.includes(gc.id), "'금' 검색에 금 포함");
ok(!resGold.includes(zn.id), "'금' 검색에 금리(ZN) 제외");
ok(L.search(cat.records, "금리").map(r => r.id).includes(zn.id), "'금리' 검색에 ZN 포함");
const resCL = L.search(cat.records, "CL");
ok(resCL[0] && resCL[0].id === "ibkr:NYMEX:CL", "'CL' 정확일치 최우선", resCL[0] && resCL[0].id);
ok(resCL.map(r => r.id).includes("ibkr:KSE:CL"), "KSE:CL도 별도 검색됨");
ok(resCL[0].id !== "ibkr:KSE:CL" || resCL.length === 1, "동점 시 순서 안정");
const resFEF = L.search(cat.records, "FEF").map(r => r.id);
ok(resFEF.includes("ibkr:SGX:FEF"), "SGX:FEF 검색됨");
const tfMap = map.find(m => m.legacy_code === "TF");
ok(tfMap && !tfMap.instrument_id, "TF 미연결(null) 유지");
const bMap = map.find(m => m.legacy_code === "B");
ok(bMap && bMap.instrument_id === "ibkr:IPE:COIL", "B→IPE:COIL");
const multi = L.search(cat.records, "나스닥 CME");
ok(multi.length > 0 && multi.every(r => {
  const hay = (r.name_ko + " " + r.name_en + " " + r.venue_code).toLowerCase();
  return hay.includes("나스닥") && hay.includes("cme");
}), "다중단어 AND");
const calcIds = L.calcIdsFromMap(map);
ok(calcIds.size === 56, "계산 연결 56개");

// 4. 필터·페이지·해시
const f1 = L.applyFilters(cat.records, { types: ["exchange_product"] });
ok(f1.length === 703, "기본 필터 703행");
const f2 = L.applyFilters(cat.records, { types: ["exchange_product"], assets: ["energy"], calcIds, calc: "yes" });
ok(f2.length > 0 && f2.every(r => r.asset_class === "energy" && calcIds.has(r.id)), "복합 필터");
const pg = L.paginate(f1, 2, 25);
ok(pg.rows.length === 25 && pg.pages === 29 && pg.total === 703, "페이지네이션", JSON.stringify({ rows: pg.rows.length, pages: pg.pages }));
const h = L.buildHash({ q: "금", assets: ["metals"], page: 2, size: 50, view: "search" });
const back = L.parseHash(h);
ok(back.q === "금" && back.assets[0] === "metals" && back.page === 2 && back.size === 50, "해시 왕복", h);

console.log(`\n통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
