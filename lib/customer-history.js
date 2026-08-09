// ============================================
// customer-history.js — 长期客户记忆(R5:复发识别)
//
// 场景:客户又来报修同一个问题,bot 却像第一次见面一样问"什么型号?" ——
// 真实记录里有一台风扇一年修 6+ 次,客户已经在说 "Tolong la buat betul²"
// "Setiap sama je"。无感情地再走一遍完整问卷等于火上浇油。
//
// 原则:代码查、代码算结论,模型只负责把话说自然。
// 本模块全是纯函数(不触网),查库在 index.js(getCustomerOrders,带缓存)。
//
// 已接受的边界(Edwin 2026-08-10 定):
// - 历史 WhatsApp 记录不导入(身份对不上,WhatsApp 化后再说)——从零累计,
//   复发从系统内第二次起才认得出
// - status 全是 new(工单流转未建),"上次那单处理得怎样"信号退化 → 不喂,
//   宁可不说,也不说"还在处理中"(现在那是真的,但意思完全不同)
// - 同一家两台同型号分不出来(无序列号)——启发式,师傅上门确认
// - issue_type unknown 的会漏 —— 宁可漏检不误伤
// ============================================

const { normalizeModel } = require('./invoice-reader');

/**
 * 型号匹配键:归一化 family 优先("FS Series 563 L" 和 "FS563L" 同键);
 * 归一化不出的退回裸串(小写去符号)。两次都归一化不出且裸串不同 → 当不同风扇。
 */
function modelKey(modelText) {
  const raw = String(modelText || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!raw || raw === 'unknown') return null;
  const n = normalizeModel(modelText);
  if (n.matched && n.family) {
    // family 粒度太粗:FS423 和 FS563 都是 FS 家族,不是同一台。
    // 键 = family + 首段数字("FS Series 563 L"→FS:563,"FS563L"→FS:563)。
    // 同家族但一边没数字 → 键不同 → 当不同风扇(宁可漏检不误伤)。
    const digits = (raw.match(/\d{2,}/) || [''])[0];
    return `fam:${n.family}:${digits}`;
  }
  return `raw:${raw}`;
}

/**
 * 在既有工单里找"同一台风扇"。priorOrders 按 created_at desc 传入。
 * 返回 null(不是复发)或 { count, sameIssueCount, lastAt, model }。
 */
function findRecurrence(priorOrders, modelText, issueType) {
  const key = modelKey(modelText);
  if (!key) return null;
  const same = (priorOrders || []).filter((o) => modelKey(o.model) === key);
  if (!same.length) return null;
  const sameIssue = issueType && issueType !== 'unknown'
    ? same.filter((o) => o.issue_type === issueType)
    : [];
  return {
    count: same.length,
    sameIssueCount: sameIssue.length,
    lastAt: same[0].created_at || null,
    model: same[0].model || modelText,
  };
}

/**
 * 回头客 system note —— 喂给模型的全部事实 + 行为要求。
 * ⚠️ 只给事实清单,绝不提任何单的 status(第 4 条写死)。
 */
function buildCustomerNote(orders) {
  if (!orders || !orders.length) return null;
  const lines = orders.slice(0, 5).map((o) => {
    const when = String(o.created_at || '').slice(0, 10);
    const part = o.issue_type && o.issue_type !== 'unknown' ? o.issue_type : (o.issue || 'issue unclear');
    return `- ${o.model || 'model unknown'} | ${part} | ${when}${o.address ? ` | address on file: ${o.address}` : ''}`;
  });
  return `[system note: RETURNING CUSTOMER — this chat has ${orders.length} previous repair record(s) in our system:\n` +
    `${lines.join('\n')}\n` +
    `If the current message is about a fan problem, do NOT restart the intake as if meeting them for the first time:\n` +
    `(1) FIRST confirm whether it is the same fan again — name it in their language (e.g. "是上次那台 ${orders[0].model} 又出问题吗?" — vary the wording naturally).\n` +
    `(2) Acknowledge the repeat trouble with brief, genuine empathy BEFORE any process talk (e.g. "不好意思又让你麻烦了" style). A customer whose fan keeps failing is already frustrated; mechanically walking the full questionnaire again makes it worse.\n` +
    `(3) If they confirm it is the same fan, do NOT re-ask model/brand — use the record above. For the address, confirm the one on file instead of asking from scratch ("地址还是 ... 吗?").\n` +
    `(4) NEVER state whether any previous order was resolved, unresolved, or being handled — you do not know its status. Do not mention order status at all.\n` +
    `(5) If they say it is a different fan, run the normal intake.]`;
}

module.exports = { modelKey, findRecurrence, buildCustomerNote };
