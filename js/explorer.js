/* 종목 찾기 순수 로직 (DOM 없음 — node 테스트와 브라우저 공용) */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { root.EXPLORER = api; }
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
function toks(q) { return norm(q).split(/\s+/).filter(Boolean); }

function kwTokens(row) {
  const out = [];
  String(row.search_keywords || "").split("|").forEach(t => { t = norm(t); if (t) out.push(t); });
  return out;
}
function codeCands(row) {
  return [row.trading_class, row.underlying_symbol].map(norm).filter(Boolean);
}
function idTail(row) { return norm(String(row.id || "").split(":").pop()); }

/* 단일 글자 토큰은 코드 전체일치 또는 키워드 토큰 전체일치만 허용.
   예: "금"이 "금리" 상품에 섞이지 않게 함 */
function tokenHit(row, tok, kws, codes, hay) {
  if (tok.length === 1) {
    if (codes.indexOf(tok) >= 0) return 3;
    if (kws.indexOf(tok) >= 0) return 2;
    return 0;
  }
  if (codes.indexOf(tok) >= 0) return 3;
  if (hay.indexOf(tok) >= 0) return 1;
  return 0;
}

function matchRow(row, tokens, fullQ) {
  const kws = kwTokens(row), codes = codeCands(row);
  const hay = norm([row.id, row.name_ko, row.name_en, row.venue_code,
    row.trading_class, row.underlying_symbol, row.search_keywords,
    row.subcategory, row.asset_class].join(" "));
  let score = 0;
  for (const t of tokens) {
    const h = tokenHit(row, t, kws, codes, hay);
    if (!h) return { ok: false, score: 0 };
    score += h;
  }
  if (fullQ && (codes.indexOf(fullQ) >= 0 || idTail(row) === fullQ)) score += 50;
  return { ok: true, score };
}

function search(records, q) {
  const tokens = toks(q);
  const fq = tokens.length === 1 ? tokens[0] : null;
  const out = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!tokens.length) { out.push({ row: r, score: 0, idx: i }); continue; }
    const m = matchRow(r, tokens, fq);
    if (m.ok) out.push({ row: r, score: m.score, idx: i });
  }
  out.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return out.map(x => x.row);
}

function applyFilters(records, f) {
  return records.filter(r => {
    if (f.types && f.types.length && f.types.indexOf(r.record_type) < 0) return false;
    if (f.assets && f.assets.length && f.assets.indexOf(r.asset_class) < 0) return false;
    if (f.subs && f.subs.length && f.subs.indexOf(r.subcategory) < 0) return false;
    if (f.venues && f.venues.length && f.venues.indexOf(r.venue_code) < 0) return false;
    if (f.curs && f.curs.length && f.curs.indexOf(r.currency) < 0) return false;
    if (f.sizes && f.sizes.length && f.sizes.indexOf(r.size_tier) < 0) return false;
    if (f.quals && f.quals.length && f.quals.indexOf(r.quality_status) < 0) return false;
    if (f.featured && !r.featured) return false;
    if (f.calcIds) {
      const has = f.calcIds.has(r.id);
      if (f.calc === "yes" && !has) return false;
      if (f.calc === "no" && has) return false;
    }
    return true;
  });
}

function paginate(arr, page, size) {
  const total = arr.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, page || 1), pages);
  return { rows: arr.slice((p - 1) * size, p * size), total, pages, page: p };
}

function parseHash(h) {
  const p = new URLSearchParams(String(h || "").replace(/^#/, ""));
  const list = k => (p.get(k) || "").split(",").map(s => s.trim()).filter(Boolean);
  const n = parseInt(p.get("n") || "", 10);
  return {
    q: p.get("q") || "",
    assets: list("a"), subs: list("s"), venues: list("v"), curs: list("c"),
    sizes: list("z"), quals: list("q2"), types: list("t"),
    featured: p.get("f") === "1", calc: p.get("k") || "any",
    page: Math.max(1, parseInt(p.get("p") || "1", 10) || 1),
    size: (n === 25 || n === 50 || n === 100) ? n : 25,
    id: p.get("id") || "", view: p.get("view") || "search"
  };
}
function buildHash(st) {
  const p = new URLSearchParams();
  const put = (k, v) => { if (v) p.set(k, v); };
  put("q", st.q); put("view", st.view && st.view !== "search" ? st.view : "");
  ["assets|a", "subs|s", "venues|v", "curs|c", "sizes|z", "quals|q2", "types|t"].forEach(pair => {
    const [f, k] = pair.split("|");
    if (st[f] && st[f].length) p.set(k, st[f].join(","));
  });
  if (st.featured) p.set("f", "1");
  if (st.calc && st.calc !== "any") p.set("k", st.calc);
  if (st.page > 1) p.set("p", String(st.page));
  if (st.size !== 25) p.set("n", String(st.size));
  put("id", st.id);
  const s = p.toString();
  return s ? "#" + s : "";
}

function distinct(records, field) {
  const seen = {}, out = [];
  records.forEach(r => {
    const v = r[field];
    if (v == null || v === "") return;
    if (!seen[v]) { seen[v] = 1; out.push(v); }
  });
  return out.sort();
}
function subcatsFor(records, assets) {
  const map = {};
  records.forEach(r => {
    if (assets && assets.length && assets.indexOf(r.asset_class) < 0) return;
    (map[r.asset_class] = map[r.asset_class] || {});
    if (r.subcategory) map[r.asset_class][r.subcategory] = 1;
  });
  return map;
}
function calcIdsFromMap(mapRows) {
  const s = new Set();
  (mapRows || []).forEach(m => { if (m && m.instrument_id) s.add(m.instrument_id); });
  return s;
}
function mapByInstrument(mapRows) {
  const o = {};
  (mapRows || []).forEach(m => { if (m && m.instrument_id) o[m.instrument_id] = m; });
  return o;
}

return {
  norm, toks, search, applyFilters, paginate,
  parseHash, buildHash, distinct, subcatsFor,
  calcIdsFromMap, mapByInstrument
};
});
