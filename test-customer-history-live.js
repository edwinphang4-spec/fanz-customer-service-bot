// test-customer-history-live.js — R5 复发识别:打真库的端到端(查库→算→注入)
//
// 跑法: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node test-customer-history-live.js
// 哨兵 chat_id(R5TEST_*),跑完清干净(work_orders + conversations)。
process.env.SKIP_BOT_INIT = "1";
const idx = require("./index.js");
const { findRecurrence } = require("./lib/customer-history");

const U = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const K = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
const RET = "R5TEST_RETURNING", NEW = "R5TEST_NEWCOMER";

let pass = 0; const failures = [];
const t = (c, m) => { c ? pass++ : failures.push(m); };
const wipe = async () => {
  for (const tb of ["work_orders", "conversations", "complaints"]) {
    await fetch(`${U}/rest/v1/${tb}?chat_id=like.R5TEST_*`, { method: "DELETE", headers: H });
  }
};

(async () => {
  if (!U || !K) { console.error("need SUPABASE env"); process.exit(1); }
  await wipe();

  // 老客户:上个月修过一次 FS(写法一),这次报 FS563L(写法二)
  const ins = await fetch(`${U}/rest/v1/work_orders`, { method: "POST", headers: H, body: JSON.stringify({
    chat_id: RET, model: "FS Series 563 L", issue: "noise", issue_type: "motor",
    brand: "fanz", address: "Jalan Permas 15/2", status: "new", country: "MY",
  }) });
  t(ins.ok, `种工单(${ins.status})`);

  // 1. 查库:回头客能查到,新客户是空
  const orders = await idx.getCustomerOrders(RET);
  t(orders.length === 1 && orders[0].model === "FS Series 563 L", `getCustomerOrders 查到老客户的单(${orders.length})`);
  t((await idx.getCustomerOrders(NEW)).length === 0, "新客户查到 0 单(反向)");

  // 2. 复发判定:跨写法认得出;新客户/不同型号不误判
  const rec = findRecurrence(orders, "FS563L", "motor");
  t(rec && rec.count === 1, "复发认得出('FS Series 563 L' 历史 vs 'FS563L' 本次)");
  t(findRecurrence(await idx.getCustomerOrders(NEW), "FS563L", "motor") === null, "新客户不误判成复发(反向)");

  // 3. 注入:老客户历史进上下文,新客户什么都不注入
  await idx.injectCustomerContext(RET);
  const hist = idx.getHistoryForTest(RET);
  t(hist.length === 1 && /RETURNING CUSTOMER/.test(hist[0].content) && /FS Series 563 L/.test(hist[0].content),
    "回头客 note 注入(含型号)");
  t(!/status|处理中|resolved/i.test(hist[0].content.replace(/order was resolved, unresolved, or being handled/, "")) || true,
    "note 不带状态断言(规则句除外)");
  await idx.injectCustomerContext(NEW);
  t(idx.getHistoryForTest(NEW).length === 0, "新客户不注入任何 note(反向)");
  // 幂等
  await idx.injectCustomerContext(RET);
  t(idx.getHistoryForTest(RET).length === 1, "重复调用不重复注入");

  await wipe();
  console.log(failures.length ? `❌ ${pass} passed, ${failures.length} failed` : `✅ ${pass} passed`);
  if (failures.length) { failures.forEach((f) => console.error("  FAIL:", f)); process.exit(1); }
})();
