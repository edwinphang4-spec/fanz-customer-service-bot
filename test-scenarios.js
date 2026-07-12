// ============================================
// test-scenarios.js — 端到端场景测试（真实管线）
//
// 通过 processCustomerText 跑完整对话管线（确定性护栏 + 真实 LLM），
// 捕获 bot 实际发出的消息断言行为。覆盖：钱红线、型号→品牌→保修、
// V605 陷阱、Vioz、认不出转人工、三语、发票照片回显。
//
// 跑法：
//   确定性场景（无需 key）：node test-scenarios.js
//   含 LLM 场景：OPENROUTER_API_KEY=... node test-scenarios.js
//   含发票照片：+ FANZ_INVOICE_DIR=/path
//
// 注意：不设 SUPABASE_* → insertWorkOrder / lookupInvoice 自动跳过，
// 无 DB 副作用。SKIP_BOT_INIT=1 → bot 不 polling，回复被捕获。
// ============================================

process.env.SKIP_BOT_INIT = "1";
const bot = require("./index.js");

let pass = 0, fail = 0, idx = 0;
const t = (cond, msg) => { cond ? (pass++, console.log(`  PASS: ${msg}`)) : (fail++, console.error(`  FAIL: ${msg}`)); };

// 跑一段对话，返回 bot 发出的全部可见文本（去掉 DATA marker 行）
async function run(chatId, messages) {
  bot.__clearSent();
  for (const m of messages) await bot.processCustomerText(chatId, m);
  return bot.__getSent()
    .map((s) => s.text.split("\n").filter((l) => !l.includes("||DATA||")).join("\n").trim())
    .filter(Boolean)
    .join("\n---\n");
}
const chat = () => 900000 + (idx++);

(async () => {
  const hasLLM = Boolean(process.env.OPENROUTER_API_KEY);

  // ── 1. 钱红线（确定性，无需 LLM）──
  console.log("\n[1] 钱红线 — 砍价/赔偿/欠款 命中预审话术（变体轮换，锚点必在）");
  {
    const r = await run(chat(), ["can you give me discount for the repair?"]);
    t(/colleague/i.test(r) && /24 hours/i.test(r) && !/\d+%|discount of|can offer/i.test(r), "discount → 转人工预审话术（锚点 colleague+24h），不接价");
  }
  {
    const r = await run(chat(), ["我要求你们赔偿我的误工费"]);
    t(/同事/.test(r) && /24小时/.test(r) && !/赔偿金额|可以赔/.test(r), "compensation(zh) → 预审话术（锚点 同事+24小时）不谈赔偿");
  }
  {
    const r = await run(chat(), ["nak claim compensation sebab kipas rosak"]);
    t(/colleague|follow up/i.test(r), "compensation(ms) → 转人工");
  }

  // ── 2/3/4/5 需要 LLM（型号→品牌→保修 / V605 / Vioz / 三语 / 认不出）──
  if (!hasLLM) {
    console.log("\n[2-5] SKIP：设 OPENROUTER_API_KEY 跑 LLM 意图/保修场景");
  } else {
    console.log("\n[2] 认不出的型号 → 先问品牌，不下保修结论（R6 钱红线）");
    {
      const r = await run(chat(), ["my ceiling fan motor is not working, can claim warranty?"]);
      t(/brand|jenama|fanz|vioz|model|which/i.test(r) && !/10 ?year|保修10|covered for 10/i.test(r),
        "unknown model motor → 问品牌/型号，绝不报 10 年");
    }

    console.log("\n[3] Fanz 型号 → 不会误报成 Vioz 5 年");
    {
      const r = await run(chat(), ["my Fanz FS563 fan is noisy, motor problem, can claim?"]);
      t(!/5 ?year|5年|vioz/i.test(r), "FS563 不会被说成 Vioz/5 年");
    }

    console.log("\n[4] V605 陷阱 → 不被判成 Vioz/5 年（问品牌是允许的）");
    {
      const r = await run(chat(), ["fan model V605 motor rosak", "boleh claim tak?"]);
      // 允许 bot 问 "Fanz 还是 Vioz?"（含 vioz 字样）；只禁止"判成 Vioz/报 5 年"
      t(!/5 ?year|5 ?tahun|5\s*年|is (a )?vioz|adalah vioz|jenama vioz\b/i.test(r), "V605 不被判成 Vioz/5 年");
    }

    console.log("\n[5] 三语 — 各来一条，语言跟随");
    {
      const zh = await run(chat(), ["你好，我的风扇不会转了"]);
      t(/[一-龥]/.test(zh), "中文输入 → 中文回复");
      const ms = await run(chat(), ["kipas saya tak boleh pusing, macam mana"]);
      t(/\b(boleh|awak|kami|ya|kipas)\b/i.test(ms), "BM 输入 → BM 回复");
    }
  }

  // ── 6. 发票照片回显（需真实图 + key）──
  console.log("\n[6] 发票照片 → 读取+回显（日期确认，不报保修）");
  if (hasLLM && process.env.FANZ_INVOICE_DIR) {
    const fs = require("fs");
    const { readInvoice } = require("./lib/invoice-reader");
    const dir = process.env.FANZ_INVOICE_DIR;
    const f = fs.readdirSync(dir).find((x) => /\.(jpe?g|png)$/i.test(x));
    const rr = await readInvoice(fs.readFileSync(`${dir}/${f}`), "image/jpeg");
    t(rr.ok, `真实发票读取 (${rr.ok ? "ok" : rr.error})`);
    if (rr.ok) {
      const echo = bot.buildInvoiceEcho(rr.result, "en");
      t(/confirm the purchase date|type the purchase date/i.test(echo), "回显要求确认购买日期");
      t(!/\d+\s*year|in warranty|out of warranty/i.test(echo), "回显不下保修结论");
      t(/colleague will verify/i.test(echo), "回显交人工核实");
    }
  } else {
    console.log("  SKIP：设 OPENROUTER_API_KEY + FANZ_INVOICE_DIR");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
