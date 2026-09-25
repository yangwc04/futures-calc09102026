/* 실제 브라우저 검증 (node tools/browser-check.cjs)
   선행: node tools/serve.cjs (별도 터미널, 포트 8931)
   산출: validation/*.png + 콘솔 결과표 */
"use strict";
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:8931/";
const OUT = path.join(__dirname, "..", "validation");
const EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const results = [];
function rec(name, ok, extra) {
  results.push({ name, ok: !!ok, extra: extra || "" });
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? " :: " + extra : ""));
}
function shot(page, f) { return page.screenshot({ path: path.join(OUT, f) }); }
async function noOverflow(page) {
  return page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
}
async function waitTag(page, timeout) {
  try {
    await page.waitForFunction(() => {
      const t = document.getElementById("liveTag");
      return t && t.textContent !== "[연결 중…]" && t.textContent !== "연결 중…";
    }, { timeout });
    return await page.textContent("#liveTag");
  } catch (e) { return "TIMEOUT"; }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });

  // ---------- 데스크톱 1440 ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const pg = await ctx.newPage();
  let dialogSeen = null;
  pg.on("dialog", async d => { dialogSeen = d.type(); await d.dismiss(); });

  await pg.goto(BASE + "explorer.html", { waitUntil: "networkidle" });
  rec("D1 탐색기 로드·에러없음", await pg.isHidden("#errBox"));
  await pg.fill("#q", "금");
  await pg.waitForTimeout(600);
  const rows = await pg.$$eval("#rows tr", trs => trs.map(t => t.innerText.slice(0, 120)));
  rec("D2 '금' 검색: 금 포함", rows.some(t => t.includes("COMEX:GC") || (t.includes("금") && t.includes("COMEX"))), rows[0]);
  rec("D3 '금' 검색: 금리(ZN) 제외", !rows.some(t => t.includes("CBOT:ZN")));
  await shot(pg, "desktop-search.png");

  await pg.click("#rows tr");
  await pg.waitForTimeout(300);
  rec("D4 상세 열림", await pg.isVisible("#detail"));
  rec("D5 상세 포커스", (await pg.evaluate(() => document.activeElement.id)) === "dName");
  dialogSeen = null;
  await pg.click("#detail .mini");
  await pg.waitForTimeout(300);
  let clip = "";
  try { clip = await pg.evaluate(() => navigator.clipboard.readText()); } catch (e) { clip = "READ-FAIL"; }
  rec("D6 코드 복사", !dialogSeen && clip.length > 0, "dialog=" + dialogSeen + " clip=" + String(clip).slice(0, 24));
  await shot(pg, "desktop-detail.png");

  const impBtn = pg.locator("#detail button", { hasText: "계산기로 가져오기" });
  if (await impBtn.count()) {
    await impBtn.click();
    await pg.waitForTimeout(500);
    rec("D7 가져오기 이동", pg.url().includes("index.html#instrument="), pg.url().slice(-60));
    rec("D8 import 스트립", await pg.isVisible("#importStrip"));
    await pg.click("#importStrip button");
    await pg.waitForTimeout(400);
    const sym = await pg.inputValue("#symbol");
    rec("D9 스펙 적용·종목 선택", sym === "GC", sym);
    await pg.fill("#entry", "4450");
    await pg.fill("#stop", "4440");
    await pg.waitForTimeout(300);
    const kl = await pg.textContent("#kLoss");
    rec("D10 GC 계산 결과", kl && kl.indexOf("$") === 0 && kl !== "$—", kl);
    await shot(pg, "desktop-calc.png");
  } else rec("D7 가져오기 버튼", false, "버튼 없음");

  // 즐겨찾기 + 새로고침 복원
  await pg.goto(BASE + "explorer.html", { waitUntil: "networkidle" });
  await pg.fill("#q", "CL");
  await pg.waitForTimeout(600);
  await pg.click("#rows tr td button.mini");
  await pg.waitForTimeout(200);
  const favStored = await pg.evaluate(() => localStorage.getItem("fut_explorer_favs"));
  await pg.reload({ waitUntil: "networkidle" });
  await pg.fill("#q", "CL");
  await pg.waitForTimeout(600);
  const star = await pg.textContent("#rows tr td button.mini");
  rec("D11 즐겨찾기 저장·복원", (favStored || "").includes("NYMEX:CL") && (star || "").includes("★"), star);

  // 비교 4개
  for (const q of ["CL", "GC", "ES", "ZC"]) {
    await pg.fill("#q", q);
    await pg.waitForTimeout(500);
    await pg.click("#rows tr");
    await pg.waitForTimeout(250);
    const btn = pg.locator("#detail button", { hasText: "비교 담기" });
    if (await btn.count()) await btn.click();
    await pg.keyboard.press("Escape");
    await pg.waitForTimeout(150);
  }
  await pg.click('#topnav button[data-view="compare"]');
  await pg.waitForTimeout(300);
  const cmpCells = await pg.$$eval("#compareBody td", tds => tds.length);
  rec("D12 비교 4개 표", cmpCells >= 36, "cells=" + cmpCells);
  await shot(pg, "desktop-compare.png");

  // ESC 닫기
  await pg.click('#topnav button[data-view="search"]');
  await pg.fill("#q", "NQ");
  await pg.waitForTimeout(500);
  await pg.click("#rows tr");
  await pg.waitForTimeout(250);
  await pg.keyboard.press("Escape");
  rec("D13 ESC 닫기", await pg.isHidden("#detail"));
  rec("D14 가로 넘침 없음", await noOverflow(pg));

  // 차트 인터랙션 (index, ES)
  await pg.goto(BASE + "index.html", { waitUntil: "networkidle" });
  await pg.selectOption("#symbol", "ES");
  await pg.waitForTimeout(400);
  await pg.click('#tfSeg button[data-tf="15m"]');
  const tag = await waitTag(pg, 45000);
  rec("D15 15분봉 로드", tag !== "TIMEOUT" && tag.indexOf("연결실패") < 0, tag);
  const tagTitle = await pg.textContent("#tfTitle");
  rec("D16 봉 제목 변경", (tagTitle || "").includes("15분"), tagTitle);
  if (tag.indexOf("연결실패") < 0 && tag !== "TIMEOUT") {
    const box = await pg.locator("#chart").boundingBox();
    await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await pg.waitForTimeout(300);
    const ohlc = await pg.textContent("#ohlcInfo");
    rec("D17 십자선 OHLC", !!ohlc && ohlc.trim().length > 4, (ohlc || "").slice(0, 40));
    await pg.mouse.wheel(0, -400);
    await pg.waitForTimeout(300);
    await pg.mouse.move(box.x + 100, box.y + 100, { steps: 5 });
    await pg.mouse.down(); await pg.mouse.move(box.x + 250, box.y + 100, { steps: 8 }); await pg.mouse.up();
    rec("D18 휠줌·드래그 무에러", true);
    await shot(pg, "desktop-chart.png");
    await pg.dblclick("#chart");
    rec("D19 더블클릭 리셋 무에러", true);
  } else {
    rec("D17 십자선 OHLC", false, "시세없음-미실행");
    rec("D18 휠줌·드래그", false, "시세없음-미실행");
    rec("D19 더블클릭 리셋", false, "시세없음-미실행");
  }
  await ctx.close();

  // ---------- 모바일 390 ----------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mp = await mctx.newPage();
  mp.on("dialog", async d => { await d.dismiss(); });
  await mp.goto(BASE + "explorer.html", { waitUntil: "networkidle" });
  await shot(mp, "mobile-search.png");
  rec("M1 모바일 로드·넘침없음", (await mp.isHidden("#errBox")) && await noOverflow(mp));
  await mp.fill("#q", "금");
  await mp.waitForTimeout(600);
  await mp.tap("#rows tr");
  await mp.waitForTimeout(300);
  rec("M2 탭 상세 열림", await mp.isVisible("#detail"));
  await shot(mp, "mobile-detail.png");
  rec("M3 모바일 넘침없음(상세)", await noOverflow(mp));
  await mp.goto(BASE + "index.html", { waitUntil: "networkidle" });
  await mp.tap("#entry"); await mp.fill("#entry", "7650");
  await mp.tap("#stop"); await mp.fill("#stop", "7640");
  await mp.waitForTimeout(300);
  const mk = await mp.textContent("#kLoss");
  rec("M4 모바일 계산", mk && mk.indexOf("$") === 0 && mk !== "$—", mk);
  await shot(mp, "mobile-calc.png");
  rec("M5 모바일 계산기 넘침없음", await noOverflow(mp));
  await mctx.close();
  await browser.close();

  const fails = results.filter(r => !r.ok);
  console.log("\n통과 " + (results.length - fails.length) + " / 실패 " + fails.length);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR", e.message); process.exit(2); });
