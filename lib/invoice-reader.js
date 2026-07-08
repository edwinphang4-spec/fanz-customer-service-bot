// ============================================
// invoice-reader.js — 读客户发来的保修凭证发票（视觉提取 + 型号归一化）
//
// 客户报保修时发发票照片/PDF当凭证。真实发票很乱：打印/热敏/手写/截图/
// 糊照片，一单混多个品牌，型号写法五花八门，日期格式全不同。
//
// 本模块只做"读 + 归一化 + 递人工"，**不自动批保修**：
// - 抠出 {品牌线索, 型号, 购买日期, 经销商, Fanz/Vioz 扇行数} —— 零客户 PII
// - 型号归一化到规范族（来自 27 张真实发票，2026-07-08）
// - 日期回显让客户确认（读错日期 = 保修判错，钱的风险）
// - Vioz/Fanz 不确定 → 交人工，不下保修结论
//
// PII：视觉模型被明确要求只回非 PII 字段，绝不返回客户姓名/电话/地址。
// 原图不落库，抠完即弃。数据出境层级与现有语音转写（OpenAI）一致。
// ============================================

const VISION_MODEL = process.env.INVOICE_VISION_MODEL || 'openai/gpt-4o';
const TIMEOUT_MS = 45_000;

function isConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

// ── 型号族归一化表（发票实证；与 docs/model-normalization.md 一致）──
// 每族: 关键词(小写去符号后 includes 匹配) → 规范族名 + 品牌
const FAMILIES = [
  // Fanz 主线（马达 10 年）
  { keys: ['gaze'], family: 'Gaze', brand: 'fanz' },
  { keys: ['grande', 'grand52', 'grand45'], family: 'Grande', brand: 'fanz' },
  { keys: ['aura'], family: 'Aura', brand: 'fanz' },
  { keys: ['inno'], family: 'Inno', brand: 'fanz' },
  { keys: ['spinor'], family: 'Spinor', brand: 'fanz' },
  { keys: ['v605'], family: 'V605', brand: 'fanz' }, // 发票逐字标 FANZ，非 Vioz
  { keys: ['eco435', 'eco'], family: 'Eco', brand: 'fanz' },
  { keys: ['axel', 'fanzo'], family: 'Axel', brand: 'fanz' },
  // FS：只在 "fs" 紧跟数字时匹配（fs423 等），避免 'fs' 子串误吞
  // （proofs / roofsheet / 地址片段）。test 优先于 keys。
  { test: /fs\d/, keys: ['fsseries'], family: 'FS', brand: 'fanz' },
  { keys: ['smartseries'], family: 'Smart', brand: 'fanz' },
  // Vioz 子线（马达 5 年，待 Fanz 最终确认）
  { keys: ['windy', 'mk2', 'mkii', 'mk11'], family: 'Vioz Windy', brand: 'vioz' },
  { keys: ['vetta'], family: 'Vioz Vetta', brand: 'vioz' },
  { keys: ['cf16'], family: 'Vioz CF16', brand: 'vioz' },
  { keys: ['ff565'], family: 'Vioz FF565', brand: 'vioz' },
  { keys: ['vioz', 'vios'], family: 'Vioz', brand: 'vioz' }, // 裸 Vioz / 疑似拼错
];

/**
 * 型号字符串 → { family, brand, matched }。匹配不到返回 unknown。
 * FS 这类短前缀放最后，避免误吞。
 */
function normalizeModel(modelText) {
  const norm = (modelText || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!norm) return { family: null, brand: 'unknown', matched: false };
  for (const f of FAMILIES) {
    if (f.test && f.test.test(norm)) return { family: f.family, brand: f.brand, matched: true };
    if (f.keys && f.keys.some((k) => norm.includes(k))) {
      return { family: f.family, brand: f.brand, matched: true };
    }
  }
  return { family: null, brand: 'unknown', matched: false };
}

// 防御性 PII 清洗：视觉模型被要求不返回 PII，但不能只靠它守规矩。
// 型号/经销商/notes 离开本模块前再过一道——刮掉电话、长数字串（IC）、
// 地址词。型号串（FS 423 N / V605 / WINDY-56）不含这些，不会被误伤。
function scrubPII(s) {
  if (!s) return s;
  return String(s)
    .replace(/\b0\d[-\s]?\d{6,9}\b/g, '[redacted]')          // 马来西亚电话
    .replace(/\+?\b60\d[-\s]?\d{6,9}\b/g, '[redacted]')       // +60 电话
    .replace(/\b\d{6,}\b/g, '[redacted]')                     // 长数字串（IC/账号）
    .replace(/\b(no\.?|lot|jalan|jln|taman|tmn|lorong|lrg|persiaran)\b[^,;]*/gi, '[redacted]') // 地址词
    .trim();
}

const PROMPT =
  'You are reading a photo or scan of a PURCHASE INVOICE that a customer sent as ' +
  'proof for a ceiling-fan warranty claim. The brand is Fanz (or its budget sub-line Vioz).\n\n' +
  'Return ONLY valid JSON (no markdown) with EXACTLY these fields:\n' +
  '{\n' +
  '  "is_invoice": true/false,               // is this actually a purchase invoice/receipt?\n' +
  '  "fanz_or_vioz_lines": [                  // every Fanz/Vioz CEILING FAN line item (ignore other brands, lights, switches, ovens, accessories like wifi modules)\n' +
  '    { "model_text": "verbatim model string", "brand_word": "fanz|vioz|none", "size": "e.g. 56\\" or empty", "colour": "e.g. Matt Black or empty" }\n' +
  '  ],\n' +
  '  "purchase_date_raw": "the date exactly as printed, or empty",\n' +
  '  "purchase_date_iso": "YYYY-MM-DD if confident, else empty. Malaysian invoices are DAY/MONTH/YEAR. Watch 2-digit years.",\n' +
  '  "date_ambiguous": true/false,            // true if the date format/year is unclear\n' +
  '  "dealer_name": "the shop/business that issued the invoice, or empty",\n' +
  '  "confidence": "high|medium|low",         // your overall read confidence (low for blurry/handwritten)\n' +
  '  "notes": "one short line, e.g. handwritten / blurry / multiple fans"\n' +
  '}\n\n' +
  'CRITICAL PRIVACY RULE: NEVER include the customer\'s name, phone number, IC, or home address ' +
  'anywhere in the output. The dealer/shop business name is allowed. If you see personal customer ' +
  'details, ignore them completely.\n' +
  'If it is not an invoice or you cannot read it, set is_invoice false / confidence low and leave lists empty.';

/**
 * Read an invoice image/PDF-page buffer via a vision model.
 * @param {Buffer} buffer
 * @param {string} mimeType - e.g. 'image/jpeg'
 * @returns {Promise<{ok:boolean, data?:object, error?:string}>}
 */
async function extractInvoice(buffer, mimeType) {
  if (!isConfigured()) return { ok: false, error: 'OPENROUTER_API_KEY not configured' };
  if (!buffer || buffer.length === 0) return { ok: false, error: 'empty image' };

  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${buffer.toString('base64')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://fanz.my',
        'X-Title': 'Fanz CS Bot - Invoice Reader',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 900,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const t = (await resp.text()).slice(0, 160);
      return { ok: false, error: `vision API ${resp.status}: ${t}` };
    }
    const json = await resp.json();
    const raw = json.choices?.[0]?.message?.content || '';
    const clean = raw.replace(/```json\s*|\s*```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      try { parsed = JSON.parse(m ? m[0] : ''); }
      catch { return { ok: false, error: 'model did not return JSON' }; }
    }
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Full read: vision extract + normalize. Returns a structured, PII-free result
 * plus a human-handoff summary. Does NOT decide warranty.
 *
 * @returns {Promise<{ok:boolean, result?:object, error?:string}>}
 *   result: {
 *     isInvoice, fanzLines:[{modelText,family,brand,size,colour}],
 *     purchaseDateIso, purchaseDateRaw, dateAmbiguous, dealer, confidence,
 *     brandResolved: 'fanz'|'vioz'|'unknown'|'mixed', multipleFans, notes
 *   }
 */
async function readInvoice(buffer, mimeType) {
  const ex = await extractInvoice(buffer, mimeType);
  if (!ex.ok) return ex;
  const d = ex.data || {};

  const lines = Array.isArray(d.fanz_or_vioz_lines) ? d.fanz_or_vioz_lines : [];
  const fanzLines = lines.map((l) => {
    const norm = normalizeModel(l.model_text || '');
    // 发票上明写的品牌词优先于型号推断；都没有 → 型号推断
    const brandWord = (l.brand_word || '').toLowerCase();
    const brand = (brandWord === 'fanz' || brandWord === 'vioz') ? brandWord : norm.brand;
    return {
      modelText: scrubPII(l.model_text || ''), // 防模型把 PII 塞进型号串
      family: norm.family,
      brand,
      size: l.size || '',
      colour: l.colour || '',
    };
  });

  // 整单品牌归结：全 fanz / 全 vioz / 混 / 未知
  const brands = new Set(fanzLines.map((l) => l.brand).filter((b) => b === 'fanz' || b === 'vioz'));
  let brandResolved = 'unknown';
  if (brands.size === 1) brandResolved = [...brands][0];
  else if (brands.size > 1) brandResolved = 'mixed';

  return {
    ok: true,
    result: {
      isInvoice: Boolean(d.is_invoice),
      fanzLines,
      purchaseDateIso: d.purchase_date_iso || '',
      purchaseDateRaw: d.purchase_date_raw || '',
      dateAmbiguous: Boolean(d.date_ambiguous),
      dealer: scrubPII(d.dealer_name || ''),
      confidence: d.confidence || 'low',
      brandResolved,
      multipleFans: fanzLines.length > 1,
      notes: d.notes || '',
    },
  };
}

module.exports = { readInvoice, extractInvoice, normalizeModel, scrubPII, isConfigured, FAMILIES };
