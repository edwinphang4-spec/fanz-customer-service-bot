// test-parse-marker.js — marker 解析/泄漏防护回归（确定性，无需 key）
// 起因：2026-07-13 线上实证——模型把 marker 拼在句尾同一行，旧解析只认
// "独立最后一行"，整段 ||DATA||{...}||END||[WORKORDER_READY] 漏给客户且工单没入库。
process.env.SKIP_BOT_INIT = "1";
const { parseMarker } = require("./index.js");

let pass = 0, fail = 0;
const t = (c, m) => c ? (pass++, console.log("  PASS:", m)) : (fail++, console.error("  FAIL:", m));

// 1. 线上泄漏的原样字符串（inline marker，同一行）
{
  const live = '收到，我们会尽量安排在下个月初。||DATA||{"model":"","brand":"unknown","issue":"noisy operation, fear of falling","issue_type":"onsite","invoice":"photo","address":"Jalan Waja, Taman Kijang DA, Johor","preferred_time":"early next month","country":"MY","has_media":true}||END||[WORKORDER_READY]';
  const r = parseMarker(live);
  t(r.marker === "WORKORDER_READY", "inline marker 被解析到（工单不再丢）");
  t(r.data && r.data.issue_type === "onsite" && r.data.address.includes("Jalan Waja"), "data 完整解析");
  t(r.clean === "收到，我们会尽量安排在下个月初。", `clean 只剩人话（实得: "${r.clean}"）`);
  t(!/\|\|DATA\|\||WORKORDER_READY/.test(r.clean), "clean 零 marker 碎片");
}

// 2. 规范格式（独立最后一行）——原行为不回退
{
  const r = parseMarker('好的，帮你记录了。\n||DATA||{"category":"product","content":"blade wobble"}||END||[COMPLAINT_READY]');
  t(r.marker === "COMPLAINT_READY" && r.data.category === "product" && r.clean === "好的，帮你记录了。", "规范格式照常工作");
}

// 3. JSON 坏了 → 不触发动作，但客户绝不能看到碎片
{
  const r = parseMarker('收到。||DATA||{model: broken json}||END||[WORKORDER_READY]');
  t(r.marker === null, "坏 JSON 不触发动作");
  t(r.clean === "收到。" && !/\|\|DATA\|\|/.test(r.clean), "坏 JSON 也刮干净（旧代码这里会整段泄漏）");
}

// 4. 没闭合的残块 + 孤立标签
{
  const r = parseMarker('明白了，马上安排。||DATA||{"model":"FS563"');
  t(r.clean === "明白了，马上安排。", "未闭合残块刮干净");
  const r2 = parseMarker('搞定。[WORKORDER_READY]');
  t(r2.clean === "搞定。", "孤立 [WORKORDER_READY] 标签刮干净");
}

// 5. 无 marker 纯文本 — 原样通过
{
  const r = parseMarker("请问型号是什么呢？");
  t(r.marker === null && r.clean === "请问型号是什么呢？", "纯文本不受影响");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
