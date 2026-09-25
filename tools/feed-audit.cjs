"use strict";
// 허용/차단 전 종목 Yahoo 메타 수집 → validation/feed-audit.json
const fs = require("fs");
const path = require("path");
const SYMS = ["ES=F","MES=F","NQ=F","MNQ=F","YM=F","MYM=F","RTY=F","M2K=F","EMD=F","NKD=F",
"ZB=F","UB=F","ZN=F","TN=F","ZF=F","ZT=F","6E=F","6J=F","6B=F","6C=F","6A=F","M6E=F",
"CL=F","MCL=F","NG=F","QG=F","HO=F","RB=F","GC=F","MGC=F","SI=F","SIL=F","HG=F","MHG=F",
"PL=F","PA=F","ZM=F","CC=F","BTC=F","MBT=F","ETH=F","MET=F","ZC=F","ZS=F","ZW=F","ZL=F",
"LE=F","HE=F","GF=F","SB=F","KC=F","CT=F","OJ=F","BZ=F","RTY=F","^VIX","DX-Y.NYB",
"^GSPC","^NDX","^DJI","^RUT"];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const out = {};
  for (const s of SYMS) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?interval=1d&range=5d",
        { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0" } });
      clearTimeout(t);
      if (!r.ok) { out[s] = { error: "HTTP " + r.status }; continue; }
      const j = await r.json();
      const m = j.chart.result[0].meta;
      out[s] = { price: m.regularMarketPrice, exch: m.exchangeName, type: m.instrumentType, name: m.longName || m.shortName };
    } catch (e) { out[s] = { error: String(e.message || e).slice(0, 60) }; }
    await sleep(300);
  }
  const f = path.join(__dirname, "..", "validation", "feed-audit.json");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ date: "2026-09-25", quotes: out }, null, 2));
  console.log("wrote", f);
})().catch(e => { console.error(e.message); process.exit(1); });
