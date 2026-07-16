// test-llm-retry.js — askOpenRouter 瞬时故障重试回归（确定性，替身 fetch，无需 key）
// 起因：2026-07-13 线上实证——一次偶发调用失败，客户直接看到"抱歉，我暂时连不上"。
process.env.SKIP_BOT_INIT = "1";
process.env.OPENROUTER_API_KEY = "test-fake-key";

let pass = 0, fail = 0;
const t = (c, m) => c ? (pass++, console.log("  PASS:", m)) : (fail++, console.error("  FAIL:", m));

// fetch 替身：按脚本队列返回
let script = [];
let calls = 0;
global.fetch = async () => {
  calls++;
  const step = script.shift();
  if (step === "netfail") { const e = new TypeError("fetch failed"); throw e; }
  if (typeof step === "number") {
    return { ok: false, status: step, text: async () => `err body ${step}` };
  }
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: step } }] }) };
};

const bot = require("./index.js");
// askOpenRouter 未导出——通过 processCustomerText 走会带上护栏，太重；
// 直接 require 后从模块内部拿不到，改为导出检查：若未导出则用行为探针。
const ask = bot.askOpenRouter;

(async () => {
  if (typeof ask !== "function") { console.error("askOpenRouter not exported for tests"); process.exit(1); }

  // 1. 第一次 500 → 重试成功
  script = [500, "ok-after-500"]; calls = 0;
  t(await ask([{ role: "user", content: "x" }]) === "ok-after-500" && calls === 2, "500 → 重试一次成功");

  // 2. 第一次网络层错误 → 重试成功
  script = ["netfail", "ok-after-net"]; calls = 0;
  t(await ask([{ role: "user", content: "x" }]) === "ok-after-net" && calls === 2, "网络错误 → 重试一次成功");

  // 3. 429 限流 → 重试成功
  script = [429, "ok-after-429"]; calls = 0;
  t(await ask([{ role: "user", content: "x" }]) === "ok-after-429" && calls === 2, "429 → 重试一次成功");

  // 4. 401（key 错）→ 不重试，直接抛
  script = [401, "should-not-reach"]; calls = 0;
  let threw = false;
  try { await ask([{ role: "user", content: "x" }]); } catch (e) { threw = /401/.test(e.message); }
  t(threw && calls === 1, "401 不重试直接抛（重试也没用）");

  // 5. 连续两次 500 → 最终抛（只重试一次，不无限）
  script = [500, 500]; calls = 0;
  threw = false;
  try { await ask([{ role: "user", content: "x" }]); } catch (e) { threw = /500/.test(e.message); }
  t(threw && calls === 2, "连续两次瞬时错 → 抛出（只重试一次）");

  // 6. 一次成功 → 不多打
  script = ["first-try"]; calls = 0;
  t(await ask([{ role: "user", content: "x" }]) === "first-try" && calls === 1, "正常成功不重试");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
