/* 종목 찾기 UI (DOM 전용 — 로직은 EXPLORER 사용) */
(function () {
"use strict";
const L = window.EXPLORER;
const $ = id => document.getElementById(id);

const QUAL_KO = { source_listed: "공개목록 수록", name_enriched: "이름 보강됨", name_review: "이름 확인 필요", name_missing: "이름 미확인" };
const TYPE_KO = { exchange_product: "거래소 상품", otc_product: "장외 상품", routing_alias: "경로 별칭" };
const QUOTE_KO = { contract_and_feed_review: "계약·시세 검토중", quote_unit_review: "호가단위 검토중", quote_contract_review: "계약 검토중", index_not_futures: "지수(선물 아님)", product_identity_review: "상품 동일성 검토중", custom_input: "직접입력" };
const SPEC_KO = { legacy_unverified: "기존값(미검증)", user_input: "직접입력용" };

const DATA = { records: [], mapRows: [], mapById: {}, calcIds: new Set(), assetKo: {}, subKo: {}, venueName: {}, sources: [], stats: null };
let state = null;
let searchTimer = null;
let favs = [], recent = [], compareSel = [];
function loadFavs() {
  try {
    const v = JSON.parse(localStorage.getItem("fut_explorer_favs") || "null");
    if (Array.isArray(v)) { favs = v.filter(x => typeof x === "string"); return; }
  } catch (e) {}
  const ids = [];
  try {
    const v2 = JSON.parse(localStorage.getItem("fut_favs_v2") || "null");
    if (Array.isArray(v2)) v2.forEach(x => { if (x && x.id) ids.push(x.id); });
  } catch (e) {}
  if (!ids.length) {
    try {
      const old = JSON.parse(localStorage.getItem("fut_favs") || "[]");
      old.forEach(c => {
        const row = (DATA.mapRows || []).find(m => m.legacy_code === c);
        if (row && row.instrument_id) ids.push(row.instrument_id);
      });
    } catch (e) {}
  }
  favs = ids.filter((v, i) => ids.indexOf(v) === i);
  saveFavs();
}
function saveFavs() { try { localStorage.setItem("fut_explorer_favs", JSON.stringify(favs)); } catch (e) {} }
function isFav(id) { return favs.indexOf(id) >= 0; }
function toggleFav(id) {
  const i = favs.indexOf(id);
  if (i >= 0) favs.splice(i, 1); else favs.push(id);
  saveFavs();
}
function loadRecent() {
  try {
    const v = JSON.parse(localStorage.getItem("fut_explorer_recent") || "null");
    recent = Array.isArray(v) ? v.filter(x => typeof x === "string").slice(0, 10) : [];
  } catch (e) { recent = []; }
}
function pushRecent(id) {
  recent = [id].concat(recent.filter(x => x !== id)).slice(0, 10);
  try { localStorage.setItem("fut_explorer_recent", JSON.stringify(recent)); } catch (e) {}
}
function toggleCompare(id) {
  const i = compareSel.indexOf(id);
  if (i >= 0) { compareSel.splice(i, 1); return true; }
  if (compareSel.length >= 4) { alert("최대 4개까지 비교할 수 있습니다."); return false; }
  compareSel.push(id); return true;
}

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function fmt(n) { return Number(n).toLocaleString("en-US"); }

function defaultState() {
  return { q: "", assets: [], subs: [], venues: [], curs: [], sizes: [], quals: [],
    types: ["exchange_product"], featured: false, favOnly: false, calc: "any",
    page: 1, size: 25, id: "", view: "search" };
}

async function loadData() {
  const box = $("errBox");
  try {
    const [cat, map] = await Promise.all([
      fetch("data/catalog.json").then(r => { if (!r.ok) throw new Error("catalog " + r.status); return r.json(); }),
      fetch("data/calculator_map.json").then(r => { if (!r.ok) throw new Error("map " + r.status); return r.json(); })
    ]);
    DATA.records = cat.records || [];
    DATA.mapRows = map;
    DATA.mapById = L.mapByInstrument(map);
    DATA.calcIds = L.calcIdsFromMap(map);
    (cat.taxonomy || []).forEach(t => {
      if (t.asset_class && !DATA.assetKo[t.asset_class]) DATA.assetKo[t.asset_class] = t.asset_class_ko || t.asset_class;
      if (t.subcategory) DATA.subKo[t.subcategory] = t.subcategory_ko || t.subcategory;
    });
    (cat.venues || []).forEach(v => { DATA.venueName[v.venue_code] = v.display_name || v.venue_code; });
    DATA.sources = cat.sources || [];
    DATA.stats = cat.stats || null;
    return true;
  } catch (e) {
    box.style.display = "block";
    box.textContent = "데이터를 불러오지 못했습니다(" + (e && e.message) + "). 파일 직접 열기(file://)에서는 동작하지 않습니다. 로컬 서버로 여세요: node tools/serve.cjs";
    return false;
  }
}

function buildFilters() {
  const recs = DATA.records;
  // 대분류 칩
  const chips = $("assetChips"); chips.innerHTML = "";
  L.distinct(recs, "asset_class").forEach(a => {
    const b = el("button", (DATA.assetKo[a] || a), "chip" + (state.assets.indexOf(a) >= 0 ? " on" : ""));
    b.type = "button";
    b.onclick = () => {
      const i = state.assets.indexOf(a);
      if (i >= 0) state.assets.splice(i, 1); else state.assets.push(a);
      state.subs = []; state.page = 1; syncHash(); renderAll();
    };
    chips.appendChild(b);
  });
  fillSelect($("fSub"), [["", "세부분류: 전체"]].concat(
    L.distinct(recs.filter(r => !state.assets.length || state.assets.indexOf(r.asset_class) >= 0), "subcategory")
      .map(s => [s, (DATA.subKo[s] || s)])
  ), state.subs[0] || "");
  fillSelect($("fVenue"), [["", "거래소: 전체"]].concat(
    L.distinct(recs, "venue_code").map(v => [v, v + " · " + (DATA.venueName[v] || "")])
  ), state.venues[0] || "");
  fillSelect($("fCur"), [["", "통화: 전체"]].concat(L.distinct(recs, "currency").map(c => [c, c])), state.curs[0] || "");
  fillSelect($("fSize"), [["", "규모: 전체"]].concat(L.distinct(recs, "size_tier").map(s => [s, s])), state.sizes[0] || "");
  fillSelect($("fQual"), [["", "정보상태: 전체"]].concat(
    L.distinct(recs, "quality_status").map(q => [q, QUAL_KO[q] || q])
  ), state.quals[0] || "");
}
function fillSelect(sel, opts, val) {
  sel.innerHTML = "";
  opts.forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    sel.appendChild(o);
  });
  sel.value = val;
}

function currentFilter() {
  return {
    assets: state.assets, subs: state.subs, venues: state.venues, curs: state.curs,
    sizes: state.sizes, quals: state.quals, types: state.types,
    featured: state.featured, calc: state.calc, calcIds: DATA.calcIds
  };
}

function renderAll() {
  renderView();
  if (state.view !== "search") return;
  const filtered = L.applyFilters(DATA.records, currentFilter());
  const scoped = state.favOnly ? filtered.filter(r => favs.indexOf(r.id) >= 0) : filtered;
  const found = L.search(scoped, state.q);
  const pg = L.paginate(found, state.page, state.size);
  state.page = pg.page;
  $("count").textContent = "검색 결과 " + fmt(pg.total) + "개";
  renderTable(pg.rows);
  renderPages(pg);
  renderSubOptions();
  if (state.id) openDetail(state.id, false); else closeDetail(false);
}
function renderSubOptions() {
  // 선택된 대분류에 따라 세부분류 목록 갱신 (선택값 유지)
  const recs = DATA.records;
  fillSelect($("fSub"), [["", "세부분류: 전체"]].concat(
    L.distinct(recs.filter(r => !state.assets.length || state.assets.indexOf(r.asset_class) >= 0), "subcategory")
      .map(s => [s, (DATA.subKo[s] || s)])
  ), state.subs[0] || "");
}

function rowCells(tr, r) {
  const m = DATA.mapById[r.id];
  const name = el("td", null, null); name.setAttribute("data-l", "상품명");
  const star = el("button", isFav(r.id) ? "★" : "☆", "mini");
  star.type = "button"; star.title = "즐겨찾기";
  star.onclick = e => { e.stopPropagation(); toggleFav(r.id); renderAll(); };
  name.appendChild(star); name.appendChild(document.createTextNode(" "));
  name.appendChild(el("b", r.name_ko || r.name_en || r.id));
  const en = el("div", r.name_en && r.name_en !== r.name_ko ? r.name_en : r.id, "mut");
  name.appendChild(en);
  tr.appendChild(name);
  const cls = el("td", (DATA.assetKo[r.asset_class] || r.asset_class) + " · " + (DATA.subKo[r.subcategory] || r.subcategory || "-"), null);
  cls.setAttribute("data-l", "분류"); tr.appendChild(cls);
  const ven = el("td", r.venue_code || "-", null); ven.setAttribute("data-l", "거래소"); tr.appendChild(ven);
  const code = el("td", null, null); code.setAttribute("data-l", "IBKR 코드");
  code.appendChild(el("code", r.id)); tr.appendChild(code);
  const size = el("td", r.size_tier || "-", null); size.setAttribute("data-l", "규모"); tr.appendChild(size);
  const st = el("td", QUAL_KO[r.quality_status] || r.quality_status || "-", null); st.setAttribute("data-l", "상태"); tr.appendChild(st);
  const cs = el("td", null, null); cs.setAttribute("data-l", "계산스펙");
  cs.appendChild(el("span", m ? "있음" : "없음", "tag " + (m ? "ok" : "no")));
  tr.appendChild(cs);
}
function renderTable(rows) {
  const tb = $("rows"); tb.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7; td.textContent = "조건에 맞는 상품이 없습니다. 검색어·필터를 초기화해 보세요.";
    tr.appendChild(td); tb.appendChild(tr); return;
  }
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    rowCells(tr, r);
    tr.onclick = () => { state.id = r.id; syncHash(); openDetail(r.id, true); };
    tr.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); state.id = r.id; syncHash(); openDetail(r.id, true); } };
    tb.appendChild(tr);
  });
}
function renderPages(pg) {
  const box = $("pages"); box.innerHTML = "";
  const btn = (t, p, dis) => {
    const b = el("button", t); b.type = "button"; b.disabled = !!dis;
    b.onclick = () => { state.page = p; syncHash(); renderAll(); window.scrollTo(0, 0); };
    box.appendChild(b);
  };
  btn("‹", pg.page - 1, pg.page <= 1);
  box.appendChild(el("span", pg.page + " / " + pg.pages, "pgnum"));
  btn("›", pg.page + 1, pg.page >= pg.pages);
}

function kv(dl, k, v, copyable) {
  const dt = el("dt", k); const dd = el("dd", v || "-");
  dl.appendChild(dt); dl.appendChild(dd);
  if (copyable && v) {
    const b = el("button", "복사"); b.type = "button"; b.className = "mini";
    b.onclick = () => copyText(v, b);
    dd.appendChild(document.createTextNode(" ")); dd.appendChild(b);
  }
}
function copyText(t, btn) {
  const done = () => { if (btn) { btn.textContent = "완료"; setTimeout(() => { btn.textContent = "복사"; }, 1200); } };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(done, () => fallbackCopy(t, done));
  } else fallbackCopy(t, done);
}
function fallbackCopy(t, done) {
  try {
    const ta = document.createElement("textarea");
    ta.value = t; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta); done();
  } catch (e) { prompt("복사해서 사용:", t); }
}

function openDetail(id, focus) {
  const r = DATA.records.filter(x => x.id === id)[0];
  const panel = $("detail");
  if (!r) { closeDetail(false); return; }
  pushRecent(id); renderRecent();
  panel.style.display = "block";
  $("dName").textContent = r.name_ko || r.name_en || r.id;
  $("dEn").textContent = [r.name_en, r.id].filter(Boolean).join(" · ");
  const dl = $("dList"); dl.innerHTML = "";
  kv(dl, "대분류", (DATA.assetKo[r.asset_class] || r.asset_class));
  kv(dl, "세부분류", (DATA.subKo[r.subcategory] || r.subcategory || "-"));
  kv(dl, "거래소", (DATA.venueName[r.venue_code] || r.venue_code) + " (" + (r.venue_code || "-") + ")");
  kv(dl, "통화", r.currency || "-");
  kv(dl, "기초코드", r.underlying_symbol || "-", true);
  kv(dl, "Trading Class", r.trading_class || "-", true);
  kv(dl, "규모", r.size_tier || "-");
  kv(dl, "자료일", r.as_of_date || "-");
  kv(dl, "정보상태", QUAL_KO[r.quality_status] || r.quality_status || "-");
  kv(dl, "출처", r.source_id || "-");
  if (r.notes_ko) kv(dl, "비고", r.notes_ko);
  const m = DATA.mapById[r.id];
  const calc = $("dCalc"); calc.innerHTML = "";
  if (m) {
    calc.appendChild(el("b", "계산 스펙 있음 (" + (SPEC_KO[m.spec_status] || m.spec_status || "?") + ")"));
    const ul = document.createElement("ul");
    [["1pt 가치(기존값)", m.legacy_point_value], ["틱 크기(기존값)", m.legacy_tick_size],
     ["시세 심볼(기존값)", m.legacy_quote_symbol], ["시세 상태", QUOTE_KO[m.quote_status] || m.quote_status || "-"]
    ].forEach(([k, v]) => {
      const li = document.createElement("li");
      li.textContent = k + ": " + (v == null || v === "" ? "미확인" : v);
      ul.appendChild(li);
    });
    calc.appendChild(ul);
    const note = el("p", "기존 계산기 값은 공식 검증 전입니다. 단위 확인 후 계산에 사용하세요.", "mut");
    calc.appendChild(note);
  } else {
    calc.appendChild(el("b", "계산 스펙 없음"));
    calc.appendChild(el("p", "계산이 필요하면 계산기의 스펙 직접 입력을 사용하세요. 다른 상품의 값을 대입하지 마세요.", "mut"));
  }
  const rel = $("dRel"); rel.innerHTML = "";
  const oldActs = $("dActs"); if (oldActs) oldActs.remove();
  const acts = document.createElement("div");
  acts.id = "dActs";
  acts.className = "frow"; acts.style.marginTop = "12px";
  if (m) {
    const g = el("button", "계산기로 가져오기", "chip on");
    g.type = "button";
    g.onclick = () => { location.href = "index.html#instrument=" + encodeURIComponent(r.id); };
    acts.appendChild(g);
  }
  const fb = el("button", isFav(r.id) ? "★ 즐겨찾기됨" : "☆ 즐겨찾기", "chip" + (isFav(r.id) ? " on" : ""));
  fb.type = "button";
  fb.onclick = () => { toggleFav(r.id); openDetail(r.id, false); renderAll(); renderRecent(); };
  acts.appendChild(fb);
  const has = compareSel.indexOf(r.id) >= 0;
  const cb = el("button", has ? "비교에서 빼기" : "비교 담기 (" + compareSel.length + "/4)", "chip");
  cb.type = "button";
  cb.onclick = () => { toggleCompare(r.id); openDetail(r.id, false); renderCompareBar(); if (state.view === "compare") renderCompare(); };
  acts.appendChild(cb);
  panel.insertBefore(acts, rel);
  if (r.family_id) {
    const sibs = DATA.records.filter(x => x.family_id === r.family_id && x.id !== r.id).slice(0, 6);
    if (sibs.length) {
      rel.appendChild(el("b", "관련 상품 (동일 family)"));
      sibs.forEach(s => {
        const b = el("button", s.name_ko || s.name_en || s.id, "chip");
        b.type = "button";
        b.onclick = () => { state.id = s.id; syncHash(); openDetail(s.id, true); };
        rel.appendChild(b);
      });
    }
  }
  if (focus) {
    $("dName").focus();
    panel.scrollIntoView({ block: "nearest" });
  }
}
function closeDetail(sync) {
  $("detail").style.display = "none";
  if (sync) { state.id = ""; syncHash(); }
}

function renderCompareBar() {
  const bar = $("cmpBar"); if (!bar) return;
  bar.innerHTML = "";
  if (!compareSel.length) { bar.style.display = "none"; return; }
  bar.style.display = "flex";
  bar.appendChild(el("b", "비교 " + compareSel.length + "/4: "));
  compareSel.forEach(id => {
    const r = DATA.records.filter(x => x.id === id)[0];
    const c = el("button", (r && (r.name_ko || r.name_en)) || id, "chip");
    c.type = "button";
    c.onclick = () => { state.id = id; syncHash(); openDetail(id, true); };
    bar.appendChild(c);
  });
  const go = el("button", "비교 보기", "chip on"); go.type = "button";
  go.onclick = () => { state.view = "compare"; syncHash(); renderAll(); window.scrollTo(0, 0); };
  bar.appendChild(go);
  const clr = el("button", "지우기", "chip"); clr.type = "button";
  clr.onclick = () => { compareSel = []; renderCompareBar(); if (state.view === "compare") renderCompare(); };
  bar.appendChild(clr);
}
function cmpVal(r, m, kind) {
  if (kind === "pv") return m && m.legacy_point_value != null ? String(m.legacy_point_value) + " (미검증)" : "미확인";
  if (kind === "tick") return m && m.legacy_tick_size != null ? String(m.legacy_tick_size) + " (미검증)" : "미확인";
  if (kind === "quote") return m ? (QUOTE_KO[m.quote_status] || m.quote_status || "-") : "미확인";
  if (kind === "src") return (m && m.source_url) || "-";
  return "-";
}
function renderCompare() {
  const box = $("compareBody");
  box.innerHTML = "";
  if (!compareSel.length) {
    box.appendChild(el("p", "비교할 상품을 담아주세요 (최대 4개). 검색 결과의 ☆ 또는 상세 패널의 '비교 담기'를 사용하세요.", "mut"));
    return;
  }
  const rows = compareSel.map(id => DATA.records.filter(x => x.id === id)[0]).filter(Boolean);
  const table = document.createElement("table");
  table.className = "grid";
  const head = document.createElement("tr");
  head.appendChild(el("th", "항목"));
  rows.forEach(r => head.appendChild(el("th", r.name_ko || r.name_en || r.id)));
  table.appendChild(head);
  [
    ["분류", r => (DATA.assetKo[r.asset_class] || r.asset_class) + " · " + (DATA.subKo[r.subcategory] || r.subcategory || "-")],
    ["거래소", r => r.venue_code || "-"],
    ["IBKR 코드", r => r.id],
    ["통화", r => r.currency || "-"],
    ["규모", r => r.size_tier || "-"],
    ["1pt 가치", r => cmpVal(r, DATA.mapById[r.id], "pv")],
    ["틱 크기", r => cmpVal(r, DATA.mapById[r.id], "tick")],
    ["시세 상태", r => cmpVal(r, DATA.mapById[r.id], "quote")],
    ["출처", r => cmpVal(r, DATA.mapById[r.id], "src")]
  ].forEach(([label, fn]) => {
    const tr = document.createElement("tr");
    tr.appendChild(el("th", label));
    rows.forEach(r => {
      const td = el("td", fn(r)); td.setAttribute("data-l", label);
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  box.appendChild(table);
}
function renderRecent() {
  const box = $("recentChips"); if (!box) return;
  box.innerHTML = "";
  if (!recent.length) { box.style.display = "none"; return; }
  box.style.display = "flex";
  box.appendChild(el("b", "최근: "));
  recent.forEach(id => {
    const r = DATA.records.filter(x => x.id === id)[0];
    if (!r) return;
    const c = el("button", r.name_ko || r.name_en || id, "chip");
    c.type = "button";
    c.onclick = () => { state.id = id; syncHash(); openDetail(id, true); };
    box.appendChild(c);
  });
}
function renderView() {
  ["search", "compare", "about"].forEach(v => { $("view-" + v).style.display = state.view === v ? "block" : "none"; });
  document.querySelectorAll("#topnav button").forEach(b =>
    b.classList.toggle("on", b.dataset.view === state.view));
  if (state.view === "about") renderAbout();
  if (state.view === "compare") renderCompare();
}
function renderAbout() {
  const box = $("aboutBody");
  if (box.dataset.done) return;
  box.dataset.done = "1";
  const s = DATA.stats || {};
  const ul = document.createElement("ul");
  [
    ["상품 기준일", "IBKR 공개 목록 2026-09-24 · 기존 계산기 수집 2026-09-25"],
    ["전체", (s.total || DATA.records.length) + "행 (거래소 " + ((s.record_type || {}).exchange_product || "-") + " · 장외 " + ((s.record_type || {}).otc_product || "-") + " · 별칭 " + ((s.record_type || {}).routing_alias || "-") + ")"],
    ["분류", "11개 대분류 · 39개 세부분류 · 34개 거래소 표기"],
    ["대표 상품", "featured 34개 (인기·거래량 순위가 아님)"],
    ["갱신 방법", "엑셀 원본 수정 → node tools/import.cjs 실행 → JSON·CSV 재생성 (자세한 절차는 저장소 tools/ 참고)"]
  ].forEach(([k, v]) => {
    const li = document.createElement("li");
    li.appendChild(el("b", k + ": "));
    li.appendChild(document.createTextNode(v));
    ul.appendChild(li);
  });
  box.appendChild(ul);
  box.appendChild(el("p", "IBKR 공개 표에 수록된 항목이며, 전 세계 모든 활성 선물·만기별 계약·계좌별 허가 목록이 아닙니다. 출처: " +
    DATA.sources.map(x => x.display_name || x.source_id || x.code || "").filter(Boolean).slice(0, 8).join(", "), "mut"));
}

function syncHash() {
  try { history.replaceState(null, "", L.buildHash(state)); } catch (e) { location.hash = L.buildHash(state); }
}

function bind() {
  $("q").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = $("q").value; state.page = 1; syncHash(); renderAll(); }, 200);
  });
  $("q").addEventListener("keydown", e => {
    if (e.key === "Enter") { clearTimeout(searchTimer); state.q = $("q").value; state.page = 1; syncHash(); renderAll(); }
  });
  const single = (id, key) => $(id).addEventListener("change", () => {
    state[key] = $(id).value ? [$(id).value] : []; state.page = 1; syncHash(); renderAll();
  });
  single("fSub", "subs"); single("fVenue", "venues"); single("fCur", "curs");
  single("fSize", "sizes"); single("fQual", "quals");
  $("fType").addEventListener("change", () => {
    const v = $("fType").value;
    state.types = v === "all" ? [] : [v]; state.page = 1; syncHash(); renderAll();
  });
  $("fFeat").addEventListener("change", () => { state.featured = $("fFeat").checked; state.page = 1; syncHash(); renderAll(); });
  $("fFav").addEventListener("change", () => { state.favOnly = $("fFav").checked; state.page = 1; renderAll(); });
  $("fCalc").addEventListener("change", () => { state.calc = $("fCalc").value; state.page = 1; syncHash(); renderAll(); });
  $("nSize").addEventListener("change", () => { state.size = parseInt($("nSize").value, 10) || 25; state.page = 1; syncHash(); renderAll(); });
  $("btnReset").onclick = () => {
    const id = state.id, view = state.view;
    state = defaultState(); state.view = view;
    $("q").value = ""; $("fFeat").checked = false; $("fFav").checked = false; state.favOnly = false;
    $("fCalc").value = "any"; $("fType").value = "exchange_product"; $("nSize").value = "25";
    syncHash(); buildFilters(); renderAll();
  };
  $("dClose").onclick = () => { closeDetail(true); $("tblWrap").focus && $("tblWrap").focus(); };
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && $("detail").style.display !== "none") closeDetail(true);
  });
  document.querySelectorAll("#topnav button").forEach(b => {
    b.onclick = () => { state.view = b.dataset.view; state.page = 1; syncHash(); renderAll(); window.scrollTo(0, 0); };
  });
  window.addEventListener("hashchange", () => {
    const keep = state.view;
    state = Object.assign(defaultState(), L.parseHash(location.hash));
    if (!state.q && !location.hash) state.view = keep;
    $("q").value = state.q || "";
    buildFilters(); renderAll();
  });
}

async function init() {
  state = Object.assign(defaultState(), L.parseHash(location.hash));
  $("q").value = state.q || "";
  bind();
  const ok = await loadData();
  if (!ok) return;
  loadFavs(); loadRecent();
  buildFilters();
  // 저장된 단일선택 복원
  if (state.subs[0]) $("fSub").value = state.subs[0];
  if (state.venues[0]) $("fVenue").value = state.venues[0];
  if (state.curs[0]) $("fCur").value = state.curs[0];
  if (state.sizes[0]) $("fSize").value = state.sizes[0];
  if (state.quals[0]) $("fQual").value = state.quals[0];
  $("fFeat").checked = !!state.featured;
  $("fCalc").value = state.calc || "any";
  $("fType").value = state.types && state.types.length ? state.types[0] : "all";
  $("nSize").value = String(state.size);
  renderRecent(); renderCompareBar();
  renderAll();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
})();
