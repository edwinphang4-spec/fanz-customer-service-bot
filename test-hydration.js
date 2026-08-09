// test-hydration.js — ② 部署即失忆的修复:重启后正在报修的对话还在不在
//
// 打真库(conversations 表),哨兵 chat_id,跑完清干净。
// 跑法: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node test-hydration.js
process.env.SKIP_BOT_INIT = "1";
const { hydrateHistory, getHistoryForTest, __clearChat, logConversation } = require("./index.js");

const U = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const K = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
const C = "CSHYDRATE_TEST";

let pass = 0; const failures = [];
const t = (c, m) => { c ? pass++ : failures.push(m); };
const wipe = () => fetch(`${U}/rest/v1/conversations?chat_id=eq.${C}`, { method: "DELETE", headers: H });

(async () => {
  if (!U || !K) { console.error("need SUPABASE_URL + SUPABASE_SERVICE_KEY"); process.exit(1); }
  await wipe();

  // 模拟一段进行到第 3 步的报修(用生产同款 logConversation 写入,顺带测它)
  const rows = [
    ["user", "我的风扇坏了，开不了"],
    ["assistant", "了解，请问你的风扇型号是什么呢？"],
    ["user", "GRANDE 523"],
    ["assistant", "好的，是什么问题呢？马达、接收器还是 LED？"],
    ["user", "马达有声音"],
  ];
  for (const [role, content] of rows) {
    await logConversation(C, role, content, {});
    await new Promise((r) => setTimeout(r, 30)); // 保序
  }
  // 混入必须被滤掉的三类行:
  await logConversation(C, "assistant", '[guard] outbound money promise blocked ("免费"): 这次免费帮你修', { intent: "outbound_money_blocked" });
  await new Promise((r) => setTimeout(r, 30));
  // 另一个 bot(Mark)在同一 chat 的发言 —— 直接 REST 写,带 sender_name=Mark
  await fetch(`${U}/rest/v1/conversations`, { method: "POST", headers: H, body: JSON.stringify(
    { chat_id: C, role: "assistant", content: "这是 marketing bot 的月度计划回复,不该出现在客服记忆里", sender_name: "Mark", platform: "telegram", message_type: "text" }) });

  // ── 模拟部署重启:清空内存,重新水合 ──
  __clearChat(C);
  t(getHistoryForTest(C).length === 0, "重启后内存为空(前提成立)");
  await hydrateHistory(C);
  const hist = getHistoryForTest(C);

  console.log(`水合回 ${hist.length} 条:`);
  hist.forEach((h) => console.log(`  ${h.role}: ${h.content.slice(0, 40)}`));

  t(hist.length === 5, `报修进行到一半的 5 条对话都回来了(实际 ${hist.length})`);
  t(hist.some((h) => /GRANDE 523/.test(h.content)), "客户已报的型号还在 —— 不用从头再问");
  t(hist.some((h) => /马达有声音/.test(h.content)), "客户已报的问题还在");
  t(!hist.some((h) => /免费帮你修/.test(h.content)), "被拦下的钱承诺没有回到记忆(埋点行滤掉)");
  t(!hist.some((h) => /月度计划/.test(h.content)), "别的 bot(Mark)的发言没混进来");
  t(hist[0].role === "user" && /坏了/.test(hist[0].content), "顺序正确(最早的在前)");

  // 幂等:再水合一次不重复
  await hydrateHistory(C);
  t(getHistoryForTest(C).length === hist.length, "重复水合不叠加");

  await wipe();
  console.log(failures.length ? `❌ ${pass} passed, ${failures.length} failed` : `✅ ${pass} passed`);
  if (failures.length) { failures.forEach((f) => console.error("  FAIL:", f)); process.exit(1); }
})();
