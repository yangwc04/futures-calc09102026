/* index.html 인라인 스크립트 실행형 회귀 테스트 (node tools/run-calctests.cjs)
   FakeDOM + vm 으로 실제 파일 코드를 구동해 계산·마이그레이션·게이트를 검증 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const INLINE = HTML.slice(HTML.lastIndexOf("<script>") + "<script>".length, HTML.lastIndexOf("</script>"));
const CALCMAP_SRC = fs.readFileSync(path.join(ROOT, "data", "calcmap.js"), "utf8");

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}

function makeElt(id) {
  const e = {
    tag: "div", id: id || "", value: "", textContent: "", innerHTML: "",
    style: {}, dataset: {}, disabled: false, checked: false, title: "",
    children: [], options: [], width: 0, height: 0, clientWidth: 0,
    classList: {
      _s: new Set(),
      add() { for (const x of arguments) this._s.add(x); },
      remove() { for (const x of arguments) this._s.delete(x); },
      toggle(x, f) { if (f === undefined) f = !this._s.has(x); if (f) this._s.add(x); else this._s.delete(x); return f; },
      contains(x) { return this._s.has(x); }
    },
    appendChild(c) { this.children.push(c); if (this.tag === "select" && c.tag === "option") this.options.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    getContext() {
      return new Proxy({ measureText: () => ({ width: 10 }) }, {
        get(t, k) { return (k in t) ? t[k] : (() => {}); },
        set(t, k, v) { t[k] = v; return true; }
      });
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 440, height: 250 }; },
    focus() {}, scrollIntoView() {}, click() {}, select() {},
    querySelector() { return makeElt(""); }, querySelectorAll() { return []; }
  };
  return e;
}

function boot(opts) {
  opts = opts || {};
  const els = {};
  const storage = {
    _m: Object.assign({}, opts.storage || {}),
    getItem(k) { return (k in this._m) ? this._m[k] : null; },
    setItem(k, v) { this._m[k] = String(v); },
    removeItem(k) { delete this._m[k]; }
  };
  const alerts = [];
  const doc = {
    getElementById: id => els[id] || (els[id] = makeElt(id)),
    createElement: tag => { const e = makeElt(""); e.tag = tag; return e; },
    querySelectorAll: () => [], querySelector: () => makeElt(""),
    documentElement: { dataset: {} },
    addEventListener() {}, removeEventListener() {},
    body: makeElt("body"), title: ""
  };
  const sb = {
    console, URLSearchParams,
    setTimeout, clearTimeout, setInterval, clearInterval,
    AbortController,
    document: doc,
    window: { addEventListener() {}, removeEventListener() {} },
    navigator: {},
    location: { hash: opts.hash || "", href: "http://x/", pathname: "/", search: "" },
    history: { replaceState() {} },
    localStorage: storage,
    fetch: () => Promise.reject(new Error("no net")),
    alert: m => alerts.push(m),
    prompt: () => null,
    __els: els, __storage: storage, __alerts: alerts
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  if (opts.calcmap !== false) vm.runInContext(CALCMAP_SRC, sb, { filename: "calcmap.js" });
  vm.runInContext(INLINE, sb, { filename: "index-inline.js" });
  return { sb, els, storage, alerts };
}
function setInputs(els, o) {
  for (const k of Object.keys(o)) {
    if (!els[k]) els[k] = makeElt(k);
    els[k].value = o[k];
  }
}

// T1 ES 기본
{
  const { sb, els } = boot();
  els.symbol.value = "ES";
  setInputs(els, { entry: "5000", stop: "4999", qty: "1", fee: "0", slip: "0", balance: "100000" });
  sb.calc();
  ok(els.kLoss.textContent === "$50", "T1 ES 손실 $50", els.kLoss.textContent);
  ok(els.kLossPct.textContent.indexOf("0.05") >= 0, "T1 손실률 0.05%", els.kLossPct.textContent);
}
// T2 MES
{
  const { sb, els } = boot();
  els.symbol.value = "MES";
  setInputs(els, { entry: "5000", stop: "4999", qty: "1", fee: "0", slip: "0", balance: "100000" });
  sb.calc();
  ok(els.kLoss.textContent === "$5", "T2 MES 손실 $5", els.kLoss.textContent);
}
// T3 CL
{
  const { sb, els } = boot();
  els.symbol.value = "CL";
  setInputs(els, { entry: "80", stop: "79.99", qty: "1", fee: "0", slip: "0", balance: "100000" });
  sb.calc();
  ok(els.kLoss.textContent === "$10", "T3 CL 손실 $10", els.kLoss.textContent);
}
// T4 ZC 센트
{
  const { sb, els } = boot();
  els.symbol.value = "ZC";
  setInputs(els, { entry: "450", stop: "449", qty: "1", fee: "0", slip: "0", balance: "1000000" });
  sb.calc();
  ok(els.kLoss.textContent === "$50", "T4 ZC 센트 1pt=$50", els.kLoss.textContent);
  setInputs(els, { stop: "449.75" });
  sb.calc();
  ok(els.kLoss.textContent === "$12.5", "T4 ZC 0.25틱=$12.5", els.kLoss.textContent);
}
// T5 숏 + 익절
{
  const { sb, els } = boot();
  els.symbol.value = "ES";
  setInputs(els, { entry: "100", stop: "110", target: "80", qty: "1", fee: "0", slip: "0", balance: "100000" });
  sb.calc();
  ok(els.dirBadge.innerHTML.indexOf("숏") >= 0, "T5 숏 자동", els.dirBadge.innerHTML.slice(0, 40));
  ok(els.kLoss.textContent === "$500", "T5 숏 손실 $500", els.kLoss.textContent);
  ok(els.kProfit.textContent === "$1,000", "T5 숏 수익 $1000", els.kProfit.textContent);
}
// T6 수수료·슬리피지
{
  const { sb, els } = boot();
  els.symbol.value = "ES";
  setInputs(els, { entry: "6350.25", stop: "6345.25", qty: "1", fee: "2.5", slip: "2", balance: "100000" });
  sb.calc();
  ok(els.kLoss.textContent === "$277.5", "T6 순손실 $277.5", els.kLoss.textContent);
}
// T7 최대계약수 경고
{
  const { sb, els } = boot();
  els.symbol.value = "ES";
  setInputs(els, { entry: "6350.25", stop: "6345.25", qty: "1", fee: "2.5", slip: "0", balance: "10000", riskPct: "1" });
  sb.calc();
  ok(els.warn.classList.contains("show"), "T7 예산초과 경고 표시");
}
// T8 일반종목
{
  const { sb, els } = boot();
  sb.setMode("stock");
  setInputs(els, { entry: "150", stop: "140", qty: "10", fee: "1", balance: "10000" });
  sb.calc();
  ok(els.kLoss.textContent === "$101", "T8 주식 손실 $101", els.kLoss.textContent);
}
// T9 미확인 종목 fallback 금지
{
  const { sb, els } = boot();
  els.symbol.value = "NOPE";
  setInputs(els, { entry: "5000", stop: "4999", qty: "1", fee: "0", slip: "0", balance: "100000" });
  sb.calc();
  ok(els.kLoss.textContent === "$—" && els.kLossPct.textContent === "—", "T9 미확인 종목 계산 안 함", els.kLoss.textContent);
}
// T10 v4 마이그레이션
{
  const v3 = { sym: "ES", entry: "5000", stop: "4999", qty: "1", balance: "100000" };
  const { sb, storage } = boot({ storage: { fut_calc_v3: JSON.stringify(v3) } });
  const v4 = JSON.parse(storage._m.fut_calc_v4 || "null");
  ok(v4 && v4.schemaVersion === 4, "T10 v4 기록됨");
  ok(v4 && v4.instrumentId && v4.instrumentId.indexOf("ibkr:") === 0, "T10 instrumentId 연결", v4 && v4.instrumentId);
  ok(v4 && v4.priceUnit === "index_points", "T10 priceUnit 기록", v4 && v4.priceUnit);
  ok("fut_calc_v3" in storage._m, "T10 v3 보존됨");
  void sb;
}
// T11 ZC 단위 확인 배너 + 변환
{
  const v3 = { sym: "ZC", entry: "4.50", stop: "4.40", qty: "1", balance: "100000" };
  const { sb, els } = boot({ storage: { fut_calc_v3: JSON.stringify(v3) } });
  ok(els.zcBanner.style.display === "block", "T11 ZC 배너 표시");
  ok(els.kLoss.textContent === "$—", "T11 확인 전 계산 보류", els.kLoss.textContent);
  els.zcWasDollars.onclick();
  ok(els.entry.value === "450" && els.stop.value === "440", "T11 ×100 변환", els.entry.value + "/" + els.stop.value);
  ok(els.kLoss.textContent === "$500", "T11 변환 후 $500", els.kLoss.textContent);
  void sb;
}
// T12 VX 자동입력 금지
{
  const { sb, els } = boot();
  els.symbol.value = "VX";
  sb.calc();
  els.btnUsePx.onclick();
  ok(els.warn.classList.contains("show") && els.warn.innerHTML.indexOf("자동입력") >= 0, "T12 VX 자동입력 금지");
  void sb;
}
// T13 TF 자동치환 금지
{
  const { sb, els } = boot({ hash: "#legacy=TF" });
  ok(els.symbol.value !== "RTY", "T13 TF 자동치환 안 함", els.symbol.value);
  ok(els.importStrip.classList.contains("show"), "T13 TF 안내 표시");
  void sb;
}
// T14 B 자동입력 금지 + ZC 달러모드 금지/센트 허용
{
  const { sb, els } = boot();
  els.symbol.value = "B";
  sb.calc();
  els.btnUsePx.onclick();
  ok(els.warn.classList.contains("show"), "T14 B 자동입력 금지");
  const g1 = sb.autoFillState();
  void sb; void els; void g1;
}
{
  const v4 = { schemaVersion: 4, sym: "ZC", priceUnit: "dollar_per_bushel", entry: "4.5", stop: "4.4" };
  const { sb, els } = boot({ storage: { fut_calc_v4: JSON.stringify(v4) } });
  els.symbol.value = "ZC";
  sb.calc();
  ok(sb.autoFillState().ok === false, "T14 ZC 달러모드 자동입력 금지");
  void els;
}
{
  const v4 = { schemaVersion: 4, sym: "ZC", priceUnit: "cent_per_bushel", entry: "450", stop: "449" };
  const { sb } = boot({ storage: { fut_calc_v4: JSON.stringify(v4) } });
  sb.calc();
  ok(sb.autoFillState().ok === true, "T14 ZC 센트모드 자동입력 허용");
}
// T15 구조 assert
{
  ok(INLINE.indexOf("||SPECS[0]") < 0, "T15 ES-fallback 제거됨");
  ok(INLINE.indexOf("fut_calc_v4") >= 0, "T15 v4 키 사용");
  ok(INLINE.indexOf("updateZcBanner") >= 0, "T15 ZC 배너 로직");
  ok(INLINE.indexOf("autoFillState") >= 0, "T15 자동입력 게이트");
  ok(HTML.indexOf('src="data/calcmap.js"') >= 0, "T15 calcmap 연결");
}

console.log("\n통과 " + pass + " / 실패 " + fail);
process.exit(fail ? 1 : 0);
