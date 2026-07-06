// ============================================
// test-voice-transcribe.js — 真实转写测试
//
// 用系统 TTS 合成一段真实音频，走真实 OpenAI 转写接口，
// 断言：1) 转写文字包含关键词  2) 转写结果能触发钱红线
// （证明语音和打字走同一套防线）。
//
// 需要 OPENAI_API_KEY。本测试在 macOS 上用 say/afconvert 合成音频；
// CI 无 say 时跳过合成用例。
// 运行：source .env && node test-voice-transcribe.js
// ============================================

const { execSync } = require("child_process");
const fs = require("fs");
const { transcribeVoice, isConfigured } = require("./lib/transcribe");
const { detectMoneyIntent } = require("./lib/guards");

let pass = 0, fail = 0;
const t = (cond, msg) => { cond ? (pass++, console.log(`PASS: ${msg}`)) : (fail++, console.error(`FAIL: ${msg}`)); };

(async () => {
  if (!isConfigured()) {
    console.error("OPENAI_API_KEY missing — cannot run real transcription test");
    process.exit(1);
  }

  // Guard behavior without audio (deterministic)
  const empty = await transcribeVoice(Buffer.alloc(0), "voice.oga");
  t(empty.ok === false, "empty buffer rejected gracefully");

  let canSynth = true;
  try { execSync("which say afconvert", { stdio: "ignore" }); } catch { canSynth = false; }
  if (!canSynth) {
    console.log("SKIP: say/afconvert unavailable — synthesized-audio cases skipped");
  } else {
    const mk = (text, name) => {
      execSync(`say -o /tmp/${name}.aiff "${text}"`);
      execSync(`afconvert -f m4af -d aac /tmp/${name}.aiff /tmp/${name}.m4a`);
      return fs.readFileSync(`/tmp/${name}.m4a`);
    };

    // Case 1: repair phrase
    const r1 = await transcribeVoice(mk("Hello, my ceiling fan is very noisy and cannot turn", "fanz-t1"), "voice.m4a");
    t(r1.ok === true, `repair phrase transcribed (got: "${(r1.text || r1.error || "").slice(0, 60)}")`);
    t(r1.ok && /fan/i.test(r1.text) && /(nois|turn)/i.test(r1.text), "transcription contains key words");

    // Case 2: voice discount attempt must trip the money guard
    const r2 = await transcribeVoice(mk("Can you give me a discount for the repair", "fanz-t2"), "voice.m4a");
    t(r2.ok === true, `discount phrase transcribed (got: "${(r2.text || r2.error || "").slice(0, 60)}")`);
    t(r2.ok && detectMoneyIntent(r2.text) === "discount", "voice discount trips the money red line");

    for (const n of ["fanz-t1", "fanz-t2"]) {
      try { fs.unlinkSync(`/tmp/${n}.aiff`); fs.unlinkSync(`/tmp/${n}.m4a`); } catch (_) {}
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
