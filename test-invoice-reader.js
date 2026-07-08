// ============================================
// test-invoice-reader.js — 发票读取测试
//
// Tier 0（确定性，无 key）：型号归一化 + echo 护栏（日期确认/多扇/不报保修）
// Tier 1（需 OPENROUTER_API_KEY + 真实发票图）：视觉提取 + 零 PII
//
// 运行：node test-invoice-reader.js
// 真实视觉：OPENROUTER_API_KEY=... FANZ_INVOICE_DIR=/path node test-invoice-reader.js
// ============================================

const { normalizeModel, scrubPII } = require("./lib/invoice-reader");

let pass = 0, fail = 0;
const t = (cond, msg) => { cond ? (pass++, console.log(`PASS: ${msg}`)) : (fail++, console.error(`FAIL: ${msg}`)); };

// buildInvoiceEcho lives in index.js; require with bot init skipped
process.env.SKIP_BOT_INIT = "1";
const { buildInvoiceEcho } = require("./index.js");

// ── Tier 0: normalization (from 27 real invoices) ──
const NORM = [
  ["FANZ CEILING FAN V605 (MATT BLACK)", "V605", "fanz"], // V605 是 Fanz，非 Vioz
  ["FS 423 N", "FS", "fanz"],
  ["Fanz FS563L 56\"", "FS", "fanz"],
  ["FANZ-GRANDE 523-L-MW", "Grande", "fanz"],
  ["FANZ-AURA 48L-PINEWOOD", "Aura", "fanz"],
  ["GAZE-66N-MB", "Gaze", "fanz"],
  ["VIOZ WINDY MK II 56\"", "Vioz Windy", "vioz"],
  ["FANZ-VIOZ CF16 CONNER FAN", "Vioz CF16", "vioz"],
  ["VIOZ-VETTA/56N/OAK+MB", "Vioz Vetta", "vioz"],
  ["FZ-VIOZ C/FAN FF 565", "Vioz FF565", "vioz"],
  ["some random light R808", null, "unknown"],
  ["proofs of purchase", null, "unknown"],       // 'fs' 子串不再误吞
  ["roofsheet FS lane", null, "unknown"],
];
for (const [input, fam, brand] of NORM) {
  const r = normalizeModel(input);
  t(r.family === fam && r.brand === brand, `normalize "${input}" -> ${r.family}/${r.brand} (expect ${fam}/${brand})`);
}

// ── PII scrub (defensive: model must not leak, and neither do we) ──
t(!/01[- ]?2345678/.test(scrubPII("FS 423 (call 012-3456789)")), "scrubPII strips phone");
t(scrubPII("Jalan Bakawali 37 Taman X").includes("[redacted]"), "scrubPII strips address tokens");
t(scrubPII("FS 423 N") === "FS 423 N", "scrubPII leaves a clean model string intact");
t(scrubPII("HENG HENG PREMIUM SDN BHD") === "HENG HENG PREMIUM SDN BHD", "scrubPII leaves dealer name intact");

// ── Tier 0: echo guardrails ──
const echo = (over) => buildInvoiceEcho({
  isInvoice: true, fanzLines: [{ modelText: "V605", family: "V605", brand: "fanz", size: "", colour: "Matt Black" }],
  purchaseDateIso: "2024-03-10", purchaseDateRaw: "10/03/2024", dateAmbiguous: false,
  dealer: "Some Shop", confidence: "high", brandResolved: "fanz", multipleFans: false, notes: "",
  ...over,
}, "en");

// never states a warranty verdict (no "year"/"warranty covered"/"in warranty")
const clean = echo({});
t(!/\b\d+\s*year|covered under|in warranty|out of warranty|10 year|5 year/i.test(clean), "echo never states a warranty verdict");
t(/colleague will verify/i.test(clean), "echo defers warranty to a colleague");

// ALWAYS asks to confirm the date (even a confident one — wrong-but-confident
// date is the worst silent warranty error)
t(/confirm the purchase date/i.test(clean), "clear date -> STILL asks to confirm (money-safety)");
const amb = echo({ dateAmbiguous: true });
t(/confirm the purchase date/i.test(amb), "ambiguous date -> asks to confirm date");

// missing date -> asks customer to type it
const noDate = echo({ purchaseDateIso: "", purchaseDateRaw: "", dateAmbiguous: true });
t(/type the purchase date/i.test(noDate), "missing date -> asks customer to type it");

// multiple fans -> asks which one
const multi = echo({ multipleFans: true, fanzLines: [
  { modelText: "WINDY 56", family: "Vioz Windy", brand: "vioz", size: '56"' },
  { modelText: "WINDY 42", family: "Vioz Windy", brand: "vioz", size: '42"' },
] });
t(/which one has the issue/i.test(multi), "multiple fans -> asks which one");
t(/Vioz Windy 56"/.test(multi) && !/CEILING FAN VIOZ-WINDY/.test(multi), "echo shows clean normalized model, not raw string");

// trilingual smoke
t(buildInvoiceEcho({ isInvoice: true, fanzLines: [{ family: "FS", brand: "fanz" }], purchaseDateIso: "2024-01-01", dateAmbiguous: false, multipleFans: false }, "zh").includes("同事"), "zh echo renders");
t(buildInvoiceEcho({ isInvoice: true, fanzLines: [{ family: "FS", brand: "fanz" }], purchaseDateIso: "2024-01-01", dateAmbiguous: false, multipleFans: false }, "ms").includes("Colleague"), "ms echo renders");

// ── Tier 1: real vision (optional) ──
(async () => {
  const dir = process.env.FANZ_INVOICE_DIR;
  if (process.env.OPENROUTER_API_KEY && dir) {
    const fs = require("fs");
    const { readInvoice } = require("./lib/invoice-reader");
    const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).slice(0, 3);
    for (const f of files) {
      const r = await readInvoice(fs.readFileSync(`${dir}/${f}`), "image/jpeg");
      t(r.ok, `real vision read ${f} (${r.ok ? "ok" : r.error})`);
      if (r.ok) {
        const blob = JSON.stringify(r.result).toLowerCase();
        t(!/01\d[- ]?\d{6,8}|jalan |taman /.test(blob), `real read ${f} contains no customer PII`);
      }
    }
  } else {
    console.log("SKIP Tier 1: set OPENROUTER_API_KEY + FANZ_INVOICE_DIR for real vision test");
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
