// ============================================
// guards.js — 确定性防线（不依赖 LLM 自觉）
//
// 1. detectLang3: zh/en/ms 三语检测（含 BM 口语缩写）
// 2. detectMoneyIntent: 折扣/砍价、赔偿/索赔 —— 钱红线的代码层兜底，
//    命中即强制走固定话术转人工，即使 LLM 跑偏也不会说错话
// 3. detectRepairIntent: 报修意图（欠款门用）
// 4. isNudge: 孤立 "?"/催进度消息
//
// 词表来源：五段真实 WhatsApp 客服记录中的真实表达（已匿名化提炼）
// ============================================

// ── 三语检测 ─────────────────────────────────

// BM 口语词表（含真实记录中的缩写变体：x=tak, dtg=datang, skang=sekarang...）
const MS_WORDS = new Set([
  'boleh', 'bleh', 'tak', 'nak', 'kipas', 'rosak', 'esok', 'pergi', 'gi',
  'datang', 'dtg', 'bising', 'saya', 'awak', 'kami', 'kita', 'ni', 'tu',
  'dah', 'sudah', 'mcm', 'macam', 'la', 'lah', 'ke', 'kat', 'rumah',
  'balik', 'lagi', 'sikit', 'cepat', 'lambat', 'lewat', 'pukul', 'hari',
  'minggu', 'bulan', 'sampai', 'sampi', 'tolong', 'terima', 'kasih',
  'selamat', 'pagi', 'malam', 'petang', 'tengah', 'buat', 'betul',
  'salah', 'ada', 'tiada', 'xde', 'takde', 'jangan', 'jgn', 'sekarang',
  'skang', 'skrg', 'kena', 'masalah', 'baik', 'okey', 'ye', 'ya', 'tak',
  'apa', 'bila', 'mana', 'siapa', 'berapa', 'bunyi', 'pasang', 'tukar',
  'baru', 'lama', 'panas', 'angin', 'laju', 'perlahan', 'mati', 'hidup',
  'x', 'nk', 'ambil', 'anak', 'sekolah', 'hantar', 'kerja', 'cuti', 'saja', 'je',
]);

// en 里也常见的弱信号词，不单独计分（ya/la 在 Manglish 里到处都是；
// x/je 单独出现太模糊；ada 是英文人名/单词同形词——只与其他强信号组合时起作用）
const MS_WEAK = new Set(['ya', 'la', 'lah', 'ke', 'ni', 'tu', 'ok', 'okey', 'x', 'je', 'saja', 'ada']);

/**
 * 三语检测：'zh' | 'ms' | 'en'
 * 汉字 → zh；BM 强信号词 >= 2 或占比高 → ms；否则 en
 */
function detectLang3(text) {
  const t = (text || '').trim();
  if (!t) return 'en';
  if (/[一-鿿]/.test(t)) return 'zh';
  const words = t.toLowerCase().split(/[^a-z0-9²]+/).filter(Boolean);
  if (words.length === 0) return 'en';
  let strong = 0;
  for (const w of words) {
    if (MS_WORDS.has(w) && !MS_WEAK.has(w)) strong++;
  }
  // 短消息一个强信号词就够（真实消息经常只有两三个词："kipas rosak"）
  if (strong >= 2 || (strong >= 1 && words.length <= 4)) return 'ms';
  return 'en';
}

// ── 钱红线检测 ────────────────────────────────

// 折扣/砍价（en/zh/ms）
const DISCOUNT_PATTERNS = [
  // en / Manglish
  /\bdiscount\b/i, /\bcheaper\b/i, /\bcheap\s*(er|a bit|abit)?\b/i,
  /\bhalf\s*price\b/i, /\bless(er)?\s*(price|charge)\b/i,
  /\bnego(tiate|tiable)?\b/i, /\bwaive\b/i, /\bfoc\b/i, /\bfree\s*of\s*charge\b/i,
  /\bboss\s+(said|say|told|promised)\b/i, // "your boss said half price" 真实纠纷句式
  /\bbest\s*price\b/i, /\boffer\s*price\b/i,
  // zh
  /便宜/, /折扣/, /打折/, /优惠/, /减价/, /砍价/, /半价/, /免费(换|修|做)?/, /算便宜/, /老板(说|讲|答应)/, /少收/, /免掉/, /不用钱/,
  // ms
  /\bmurah\b/i, /\bdiskaun\b/i, /\bharga\s*(baik|special|runding)\b/i, /\bpercuma\b/i, /\bfree\b.*\b(ke|boleh)\b/i, /\bkurang(kan)?\s*(harga|bayar)\b/i,
];

// 赔偿/索赔（en/zh/ms）
const COMPENSATION_PATTERNS = [
  // en —— 注意：不含裸 "claim"。"claim warranty / boleh claim" 是正当报保修，
  // 不是要赔偿；裸 claim 会把报保修误判成赔偿转人工（scenario 测试实证）。
  // 真正的赔偿诉求都带更强的词（compensat/refund/damages/sue/leave…），照收。
  /\bcompensat(e|ion)\b/i, /\brefund\b/i, /\bdamages?\b/i, /\bpay\s*(me\s*)?back\b/i,
  /\bmy\s*(annual\s*)?leave\b/i, // "compensate my leave" 真实句式
  /\breimburse\b/i, /\bmoney\s*back\b/i, /\bliab(le|ility)\b/i, /\bsue\b/i, /\blawyer\b/i, /\breport\s*(to\s*)?(case|consumer|tribunal)\b/i,
  // zh
  /赔偿/, /赔钱/, /赔我/, /退款/, /退钱/, /索赔/, /投诉到/, /消协/, /告你们/, /法律/, /律师/,
  // ms
  /\bganti\s*rugi\b/i, /\bpampasan\b/i, /\brefund\b/i, /\btuntut\b/i, /\bsaman\b/i,
];

/**
 * 钱红线检测：'discount' | 'compensation' | null
 * 命中即强制转人工，代码层保证不接话。
 */
function detectMoneyIntent(text) {
  const t = (text || '').trim();
  if (!t) return null;
  for (const p of COMPENSATION_PATTERNS) {
    if (p.test(t)) return 'compensation';
  }
  for (const p of DISCOUNT_PATTERNS) {
    if (p.test(t)) return 'discount';
  }
  return null;
}

// ── ④ 出站钱承诺检测 ─────────────────────────────
// 入站守卫管客户的话("要折扣"→转人工);这个管**模型的嘴**:
// 模型主动说"免费帮你换""帮你免掉费用"没人拦 —— 2026-08-10 体检发现的洞。
// 只扫 LLM 生成的文字,不扫代码拼的消息(保修判定/固定脚本是审过的)。
//
// 模式取向:抓"承诺给好处",放过"提到钱这件事"。
// "Feel free to DM us" / "标准收费 RM60" / "折扣的事同事跟进" 都不许误伤 ——
// 误伤会把正常回复换成转人工脚本,烦人但不伤钱;漏检才伤钱。仍偏保守。
const OUTBOUND_MONEY_PATTERNS = [
  // en — 承诺句式;"free of charge/for free/free repair"是承诺,"feel free"不是
  /\bfree\s+of\s+charge\b/i,
  /\bfor\s+free\b/i,
  /\bfree\s+(repair|replacement|service|visit|installation|part)/i,
  /\bno\s+charge\b/i,
  /\bwon'?t\s+(be\s+)?charg/i,
  /\bnot\s+charge\s+you\b/i,
  /\bwaive\s*(the\s*)?(fee|charge|cost)?/i,
  /\b(give|offer|get)\s+(you\s+)?(a\s+)?(special\s+)?discount/i,
  /\bspecial\s+price\s+for\s+you\b/i,
  /\bhalf\s+price\b/i,
  // zh — 免费/不收钱/帮你免/给你折扣
  /免费(帮|给|换|修|上门|服务|维修|安装)?/,
  /不收(你的?)?(钱|费)/,
  /不用(给|付)?钱/,
  /(帮|给)你免(掉|了)?/,
  /(给|帮)你(打个?折|优惠|半价)/,
  /算你便宜/,
  // ms
  /\bpercuma\b/i,
  /tak\s+(payah|perlu)\s+bayar/i,
  /(bagi|beri)\s+(awak\s+)?diskaun/i,
  /harga\s+(special|istimewa)\s+untuk\s+awak/i,
];

/** LLM 出站回复里的钱承诺。返回命中的原文片段,没有返回 null。 */
function detectOutboundMoneyPromise(text) {
  const t = (text || '').trim();
  if (!t) return null;
  for (const p of OUTBOUND_MONEY_PATTERNS) {
    const m = t.match(p);
    if (m) return m[0];
  }
  return null;
}

// ── 出站 IC（身份证号）防线 ───────────────────────
// 起因:线下发现客服把师傅的完整身份证号发给了客户 —— PDPA 合规风险。
// bot 今天**发不出**师傅的 IC(它手上根本没有师傅资料,也没有派工功能),
// 但那是"没数据"不是"有防线"。以后加派工功能("师傅张三 012-xxx 明天上门")
// 时,这道闸已经在了,不用记得补。
//
// 处理方式是**遮蔽不是拦截**:IC 遮成 [IC redacted],消息其余部分照发 ——
// 挡整条消息会连带毁掉有用的回复,而客户要的是师傅的姓名电话,不是 IC。
//
// 误伤优先于漏检(Edwin 的老规矩),所以只认两种高置信度形态:
//   A. 带横杠的标准格式 xxxxxx-xx-xxxx —— 马来西亚电话/发票号都不长这样
//      (手机 012-3456789 是 3-7,座机 07-1234567 是 2-7,发票 INV-2026-0010 带字母)
//   B. 12 位连号,但**必须紧跟在 IC 字样后面**(IC/NRIC/kad pengenalan/身份证)
// ⛔ 不认裸的 12 位数字:+601112345678 这种国际格式手机是 12 位,
//    YYMMDD+流水号的订单号(如 260812000123)也是 12 位且日期部分合法 ——
//    分不干净就不分,宁可漏检。
const IC_DASHED = /\b\d{6}-\d{2}-\d{4}\b/g;
// 中文词不能用 \b 收尾:JS 正则里汉字不算 \w,"身份证号码 880..." 的 \b 永远不成立
const IC_LABELLED = /(?:\b(?:ic|nric|mykad|kad\s*pengenalan|no\.?\s*kp)\b|身份证(?:号码?)?)[^\d\n]{0,10}(\d{12})\b/gi;

/** 出站文字里的 IC。返回命中的原文数组(去重),没有返回 []。 */
function detectICLeak(text) {
  const t = String(text || '');
  if (!t) return [];
  const hits = new Set();
  for (const m of t.matchAll(IC_DASHED)) hits.add(m[0]);
  for (const m of t.matchAll(IC_LABELLED)) hits.add(m[1]);
  return [...hits];
}

/** 把 IC 遮掉,其余原样保留。 */
function redactIC(text) {
  let out = String(text || '').replace(IC_DASHED, '[IC redacted]');
  out = out.replace(IC_LABELLED, (full, digits) => full.replace(digits, '[IC redacted]'));
  return out;
}

// ── 报修意图（欠款门用）─────────────────────────

const REPAIR_PATTERNS = [
  // en / Manglish
  /\b(broken|broke|spoil(t|ed)?|faulty|problem|issue|not\s*working|cannot\s*(turn|on|work|move)|can'?t\s*(turn|on|work|move)|no\s*function|repair|fix|service|technician|noisy|noise|clicking|beeping|wobbl|balanc)\b/i,
  // zh
  /坏了?/, /故障/, /修理?/, /维修/, /报修/, /不(能|会)?(转|动|开)/, /开不了/, /有(声音|噪音|杂音)/, /师傅/, /上门/, /问题/,
  // ms
  /\brosak\b/i, /\bmasalah\b/i, /\bbising\b/i, /\btak\s*(boleh|jalan|pusing|hidup)\b/i, /\bx\s*(boleh|jalan|hidup)\b/i, /\bbaiki\b/i, /\bservis\b/i, /\bbunyi\b/i, /\bmati\b/i,
];

function detectRepairIntent(text) {
  const t = (text || '').trim();
  if (!t) return false;
  return REPAIR_PATTERNS.some((p) => p.test(t));
}

// ── 催促识别 ─────────────────────────────────

/**
 * 孤立 "?"/"??" 或催进度短句 —— 真实客户用来催回复，
 * 不是"无法识别的输入"。
 */
function isNudge(text) {
  const t = (text || '').trim();
  if (!t) return false;
  if (/^[?？!！.。]{1,5}$/.test(t)) return true;
  if (/^(any\s*update(s)?|update\s*(pls|please)?|so\s*how|how\s*(ah|liao)?|hello+\??|halo+\??|还没(回|好)|怎么样了?|有消息(了)?吗|macam\s*mana|bila\s*(lagi)?|dah\s*ke)\s*[?？]?$/i.test(t)) return true;
  return false;
}

// ── 固定话术（三语）——钱红线与欠款门的出口消息 ─────
//
// 每条话术备 2-3 个**预审变体**随机轮换：客户连问几次不会听到复读机，
// 但措辞永远是审过的——LLM 仍然完全不参与这些出口的用词（钱红线不即兴）。
// 锚点约定（回归测试依赖，变体里不能丢）：
//   discount/compensation: en 含 colleague+follow up；zh 含 同事+跟进；ms 含 colleague+follow up
//   ⛔ 2026-08-10 Edwin 定:不许承诺时限("24小时内联系你")。工单流转还没建,
//   没人保证 24 小时 —— 承诺了就是整个系统替公司撒谎。只说"尽快",不给期限。
//   unpaid: 含 settle/结清 + colleague/同事
//   media_*: 确认收到 + 请文字描述

const SCRIPTS = {
  discount: {
    en: [
      'For pricing and any discount, I will pass you to my colleague to follow up ya. They will contact you as soon as they can. Anything else about the fan I can help first?',
      'Pricing and discounts I will leave to my colleague to follow up ya — they will reach out as soon as possible. Meanwhile, anything about the fan itself I can help with first?',
      'Ah, price matters I cannot decide ya — let me get my colleague to follow up, they will contact you soonest possible. Can I help with anything else about the fan first?',
    ],
    zh: [
      '价钱和折扣方面我帮你转给同事跟进哦，他们会尽快联络你。风扇其他方面有什么我可以先帮你的吗？',
      '折扣这种价钱的事我做不了主哦，帮你交给同事跟进，同事会尽快联络你。风扇本身有什么问题我可以先帮你看看吗？',
      '价格方面让同事来跟你谈比较好哦，他们会尽快找你。风扇其他的事要不要我先帮你？',
    ],
    ms: [
      'Pasal harga dan diskaun, saya akan pass kepada colleague untuk follow up ya. Mereka akan hubungi awak secepat mungkin. Ada apa-apa lagi pasal kipas yang saya boleh tolong dulu?',
      'Pasal harga ni saya tak boleh decide ya — saya pass kepada colleague untuk follow up, mereka akan contact awak secepat yang boleh. Ada benda lain pasal kipas saya boleh tolong dulu?',
      'Harga dan diskaun saya serahkan pada colleague untuk follow up ya, mereka hubungi awak secepat mungkin. Sementara tu ada apa-apa pasal kipas boleh saya bantu?',
    ],
  },
  compensation: {
    en: [
      'So sorry for the trouble caused ya. I will pass this to my colleague to follow up personally — they will contact you as soon as they can. Meanwhile let me arrange the earliest slot possible for you first.',
      'Really sorry about this ya. Let me hand this to my colleague to follow up personally — they will reach out as soon as possible. In the meantime I will try to arrange the earliest slot for you first.',
      'I am so sorry for the inconvenience ya. My colleague will follow up with you personally as soon as possible. Let me help arrange the soonest possible slot for you first, okay?',
    ],
    zh: [
      '真的不好意思给你带来麻烦。这个我帮你转给同事亲自跟进，他们会尽快联络你。我先尽快帮你安排最早的时间好吗。',
      '真的很抱歉让你遇到这种情况。我把这个交给同事亲自跟进，会尽快联络你。我这边先帮你排最早的时间好吗？',
      '不好意思啊，给你添麻烦了。这件事同事会亲自跟进，尽快找你。要不我先帮你把最早的档期排上？',
    ],
    ms: [
      'Minta maaf sangat atas kesulitan ya. Saya akan pass kepada colleague untuk follow up, mereka akan hubungi awak secepat mungkin. Sementara tu saya cuba arrange slot paling awal untuk awak dulu.',
      'Maaf sangat-sangat ya atas masalah ni. Saya pass kepada colleague untuk follow up sendiri, mereka akan hubungi awak secepat yang boleh. Sementara tu saya cuba bookkan slot paling awal untuk awak.',
      'Minta maaf banyak ya. Colleague saya akan follow up dengan awak secepat mungkin. Jom saya arrange slot paling awal untuk awak dulu.',
    ],
  },
  unpaid: {
    en: [
      'Hi, our record shows the previous service payment is still pending ya. Please help to settle it first, then we arrange the new appointment for you right away. My colleague will contact you to confirm, thanks for understanding.',
      'Hi ya, our record shows there is still a pending payment from the previous service. Once that is settled we will arrange the new appointment right away — my colleague will contact you to confirm. Thanks for understanding ya.',
    ],
    zh: [
      '这边记录显示上次服务的费用还没结清哦。麻烦先清一下，我们马上帮你排新的。同事会联络你确认，谢谢理解。',
      '这边看到上次服务的费用还没结清哦，麻烦先处理一下，我们马上帮你排新的时间。同事会联络你确认，谢谢理解哦。',
    ],
    ms: [
      'Hi, rekod kami tunjuk bayaran service sebelum ni belum selesai ya. Tolong settle dulu, lepas tu kami terus arrange appointment baru untuk awak. Colleague kami akan hubungi awak untuk confirm, terima kasih.',
      'Hi ya, rekod kami tunjuk bayaran service lepas belum settle lagi. Lepas settle kami terus arrange appointment baru — colleague kami akan contact awak untuk confirm. Terima kasih ya.',
    ],
  },
  nudge: {
    en: [
      'Sorry for the wait ya, I will chase my colleague and get back to you as soon as possible.',
      'Sorry to keep you waiting ya, I am chasing my colleague now and will update you as soon as possible.',
      'Sorry ya, still waiting on my colleague — I will push them again and update you as soon as I can.',
    ],
    zh: [
      '不好意思让你久等了，我帮你催一下同事，尽快回复你哦。',
      '抱歉等久了哦，我马上去催同事，一有消息就回你。',
      '不好意思哦，我再帮你催催同事，尽快给你答复。',
    ],
    ms: [
      'Maaf sebab tunggu lama ya, saya akan kejar colleague dan reply awak secepat mungkin.',
      'Maaf tunggu lama ya, saya gesa colleague sekarang, nanti saya update awak secepat mungkin.',
      'Sorry ya, saya kejar colleague sekali lagi, dapat berita terus saya bagitahu awak.',
    ],
  },
  media_photo: {
    en: [
      'Got it, received your photo ya. Can you describe the problem briefly in text so I can help arrange?',
      'Photo received ya. Mind telling me briefly in text what is the issue, so I can help arrange?',
      'Thanks, got your photo. Can you type a quick note on what is wrong with the fan? Then I can arrange for you.',
    ],
    zh: [
      '收到你的照片了哦。可以用文字简单讲一下问题吗，我好帮你安排。',
      '照片收到啦。可以打几个字讲一下是什么问题吗？我好帮你安排。',
      '收到照片了哦，麻烦简单打字说一下状况，我来帮你安排。',
    ],
    ms: [
      'Okay, dah terima gambar awak ya. Boleh describe masalah tu sikit dalam text supaya saya boleh tolong arrange?',
      'Dah dapat gambar awak ya. Boleh taip sikit apa masalahnya supaya saya boleh arrange?',
      'Gambar received ya. Cuba describe sikit dalam text masalah kipas tu, senang saya tolong arrange.',
    ],
  },
  media_video: {
    en: [
      'Got it, received your video ya, we will show it to our technician. Can you describe the problem briefly in text as well?',
      'Got your video ya, we will show it to the technician. Can you also type briefly what happened?',
    ],
    zh: [
      '收到你的视频了哦，我们会给师傅看。也可以用文字简单讲一下问题吗？',
      '视频收到了哦，会转给师傅看。也麻烦打字简单说一下情况哈。',
    ],
    ms: [
      'Okay, dah terima video awak ya, kami akan tunjuk kepada technician. Boleh describe masalah tu sikit dalam text juga?',
      'Video dah sampai ya, kami tunjuk pada technician. Boleh taip sikit apa yang jadi?',
    ],
  },
  media_voice: {
    en: [
      'Sorry ya, I cannot listen to voice messages here. Can you type it out briefly, or send a photo/video of the fan?',
      'Sorry ya, this voice note did not come through for me. Could you type it briefly, or send a photo/video of the fan?',
      'Sorry ya, I could not catch that voice message. Mind typing it out briefly, or sending a photo/video of the fan?',
    ],
    zh: [
      '不好意思哦，语音我这边听不了。可以打字简单讲一下，或者拍个风扇的照片/视频吗？',
      '不好意思哦，这条语音我这边收不到内容。可以打字简单讲一下，或者拍张风扇的照片/视频吗？',
      '抱歉哈，语音没听成功。麻烦打几个字，或者发个风扇的照片/视频给我。',
    ],
    ms: [
      'Maaf ya, saya tak boleh dengar voice message kat sini. Boleh taip sikit, atau hantar gambar/video kipas tu?',
      'Maaf ya, voice message tu tak dapat saya proses. Boleh taip ringkas, atau hantar gambar/video kipas?',
      'Sorry ya, tak lepas dengar voice note tu. Taip sikit pun boleh, atau hantar gambar/video kipas tu.',
    ],
  },
  media_other: {
    en: [
      'Received your file ya. Can you describe the problem briefly in text so I can help arrange?',
      'File received ya. Could you type briefly what the problem is, so I can help arrange?',
    ],
    zh: [
      '收到你的文件了哦。可以用文字简单讲一下问题吗，我好帮你安排。',
      '文件收到了哦。麻烦打字简单说一下问题，我好帮你安排。',
    ],
    ms: [
      'Dah terima file awak ya. Boleh describe masalah tu sikit dalam text supaya saya boleh tolong arrange?',
      'Dah terima file tu ya. Boleh taip sikit masalahnya supaya saya boleh arrange?',
    ],
  },
};

function script(key, lang) {
  const entry = SCRIPTS[key];
  if (!entry) return '';
  const variants = entry[lang] || entry.en;
  if (!Array.isArray(variants)) return variants;
  return variants[Math.floor(Math.random() * variants.length)];
}

module.exports = {
  detectLang3,
  detectMoneyIntent,
  detectOutboundMoneyPromise,
  detectICLeak,
  redactIC,
  detectRepairIntent,
  isNudge,
  script,
  SCRIPTS,
  // exposed for tests
  MS_WORDS,
  DISCOUNT_PATTERNS,
  COMPENSATION_PATTERNS,
};
