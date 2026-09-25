"use strict";
const fs = require("fs");
const base = process.argv[2];
const map = JSON.parse(fs.readFileSync(base + "/calculator_map.json", "utf8"));
const audit = JSON.parse(fs.readFileSync("validation/feed-audit.json", "utf8")).quotes;
const allow = ["ES","MES","NQ","MNQ","YM","MYM","RTY","M2K","EMD","NKD","ZB","UB","ZN","TN","ZF","ZT","6E","6J","6B","6C","6A","M6E","CL","MCL","NG","QG","HO","RB","GC","MGC","SI","SIL","HG","MHG","PL","PA","ZM","CC","BTC","MBT","ETH","MET","ZC"];
for (const c of allow) {
  const m = map.find(x => x.legacy_code === c);
  const y = (m && m.legacy_quote_symbol) || "";
  const q = audit[y] || {};
  console.log([c, m ? m.instrument_id : "?", y, (q.name || "") + " [" + (q.type || "?") + "/" + (q.exch || "?") + "]", q.price].join(" | "));
}
