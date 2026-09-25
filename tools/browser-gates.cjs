"use strict";
/* 브라우저 게이트 검증: TF/VX/B 차단, ZC 마이그레이션 (node + serve 병행)
   실행: 서버 기동 후 node tools/browser-gates.cjs */
const { chromium } = require("playwright-core");
const R = [];
const rec = (n, ok, x) => { R.push(ok); console.log((ok ? "PASS " : "FAIL ") + n + (x ? " :: " + x : "")); };
const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://127.0.0.1:8931/";
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  {
    const pg = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await pg.goto(BASE + "index.html#legacy=TF", { waitUntil: "networkidle" });
    await pg.waitForTimeout(800);
    rec("G1 TF 안내+자동치환 없음",
      (await pg.isVisible("#importStrip")) && (await pg.inputValue("#symbol")) !== "RTY",
      await pg.inputValue("#symbol"));
    await pg.close();
  }
  {
    const pg = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await pg.goto(BASE + "index.html", { waitUntil: "networkidle" });
    await pg.selectOption("#symbol", "VX");
    await pg.waitForTimeout(400);
    await pg.click("#btnUsePx");
    await pg.waitForTimeout(300);
    const w = await pg.isVisible("#warn");
    const t = await pg.textContent("#warn");
    rec("G2 VX 자동입력 금지", w && t.includes("자동입력"), (t || "").slice(0, 50));
    await pg.close();
  }
  {
    const pg = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await pg.goto(BASE + "index.html", { waitUntil: "networkidle" });
    await pg.selectOption("#symbol", "B");
    await pg.waitForTimeout(400);
    await pg.click("#btnUsePx");
    await pg.waitForTimeout(300);
    rec("G3 B 자동입력 금지", await pg.isVisible("#warn"));
    await pg.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      localStorage.setItem("fut_calc_v3", JSON.stringify({ sym: "ZC", entry: "4.50", stop: "4.40", qty: "1", balance: "100000" }));
    });
    const pg = await ctx.newPage();
    await pg.goto(BASE + "index.html", { waitUntil: "networkidle" });
    await pg.waitForTimeout(800);
    rec("G4 ZC 배너 표시", await pg.isVisible("#zcBanner"));
    rec("G5 확인 전 계산 보류", (await pg.textContent("#kLoss")) === "$—");
    await pg.click("#zcWasDollars");
    await pg.waitForTimeout(400);
    const e = await pg.inputValue("#entry");
    const kl = await pg.textContent("#kLoss");
    rec("G6 x100 변환 후 계산", e === "450" && kl === "$502", e + " / " + kl);
    const v3 = await pg.evaluate(() => localStorage.getItem("fut_calc_v3"));
    const v4 = await pg.evaluate(() => localStorage.getItem("fut_calc_v4"));
    rec("G7 v3 보존+v4 기록", !!v3 && !!(v4 && JSON.parse(v4).schemaVersion === 4));
    await ctx.close();
  }
  await browser.close();
  console.log("\n통과 " + R.filter(Boolean).length + " / 실패 " + R.filter(x => !x).length);
  process.exit(R.some(x => !x) ? 1 : 0);
})().catch(e => { console.error("HARNESS", e.message); process.exit(2); });
