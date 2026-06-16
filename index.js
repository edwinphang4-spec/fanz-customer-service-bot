const TelegramBot = require("node-telegram-bot-api");
const { company, products } = require("./products");

// ── Env ──────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.MODEL || "gpt-4o";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// Supabase (Fanz project)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Google Sheets (optional — backup for work orders)
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Warranty rule: placeholder — 10 years from purchase date (to be confirmed by boss)
const WARRANTY_YEARS = 10;

if (!TELEGRAM_TOKEN || !OPENROUTER_API_KEY) {
  console.error("Missing TELEGRAM_TOKEN or OPENROUTER_API_KEY");
  process.exit(1);
}

// ── System Prompt ────────────────────────────────
function buildSystemPrompt() {
  const productLines = products
    .map(
      (p) =>
        `- ${p.name} (${p.nameZh}) | Type: ${p.typeZh} (${p.type}) | Blade: ${p.bladeSize || "N/A"} (${p.bladeSizeZh || "N/A"}) | Features: ${p.featuresZh.join(" / ")}`
    )
    .join("\n");

  return `You are an AI customer service representative for Fanz Sdn Bhd, a Malaysian ceiling fan company. You communicate in the customer's preferred language (Chinese or English). You are professional, warm, and helpful. Ask at most one or two questions at a time.

=== COMPANY INFO ===
Company: Fanz Sdn Bhd
Address: ${company.address}
Phone: ${company.contactPhone}
Email: ${company.contactEmail}
Business Hours: ${company.businessHours}
Service Area: ${company.services}
Certifications: ${company.certifications.join(", ")}
Years in Business: ${company.yearsInBusiness}
Motor Warranty: ${company.warrantyNote}

=== PRODUCT INFO ===
${productLines}

=== RULES ===

1. DO NOT make up prices. If a customer asks about price, politely say pricing requires a quote from our sales team and provide phone/email.

2. WARRANTY CHECK: When a customer provides an invoice number, ask for it. Our system will look up the invoice by number in our sales records and check warranty status (10 years from purchase date). The result will be displayed to the customer automatically.

3. There are THREE service lines you handle. Detect which one the customer needs from their message:

LINE A — Product Inquiry: Answer questions about models, features, suitable room sizes, differences between models. Use the product database above. Be helpful but don't pressure.

LINE B — Repair / Maintenance: Collect these FIVE pieces of information ONE AT A TIME. After each answer, ask for the next one. Do NOT ask for all five at once.
   Step 1 — Model/Product name
   Step 2 — Problem description
   Step 3 — Invoice / proof of purchase (tell the customer they will need to provide invoice)
   Step 4 — Address for service visit
   Step 5 — Preferred time slot and date
   After all 5 are collected, say: "Thank you! Your repair request has been recorded. Our technician will contact you to arrange the visit."
   **IMPORTANT — data output format**: After you finish the thank you message, on the LAST LINE of your response, output EXACTLY this format (no extra characters):
   ||DATA||{"model":"[model]","issue":"[issue]","invoice":"[invoice]","address":"[address]","preferred_time":"[time]"}||END||[WORKORDER_READY]
   Replace [bracketed] fields with the actual data the customer provided. If any field was not provided, use an empty string. This line is for internal processing and will be stripped before the customer sees it.

LINE C — Complaint: Listen sincerely, acknowledge the issue, thank the customer for their feedback, inform them it will be forwarded to the relevant colleague. Do not argue or defend.
   **IMPORTANT — data output format**: When wrapping up the complaint response, on the LAST LINE output:
   ||DATA||{"category":"product|installation|logistics|other","content":"[summary of complaint]"}||END||[COMPLAINT_READY]

4. HANDOFF TO HUMAN: If the customer becomes emotional/angry, asks something beyond your capability, or explicitly demands to speak to a human, respond with: "I understand. Let me transfer you to a human colleague. Please leave your contact number and someone will get back to you within 24 hours."

5. LANGUAGE: Detect the language the customer is writing in and respond in the same language. If they mix Chinese and English, you may mix them naturally too.

6. PERSONALITY: Professional, warm, patient. One or two questions per message maximum. Do not overwhelm the customer.

7. If unsure about anything, be honest and offer to transfer to human team.`;
}

const SYSTEM_PROMPT = buildSystemPrompt();

// ── In-Memory Conversation Store ─────────────────
// key = chatId, value = array of { role, content } (max 16)
const conversations = new Map();

const MAX_HISTORY = 16;

function getHistory(chatId) {
  return conversations.get(chatId) || [];
}

function appendHistory(chatId, role, content) {
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }
  const history = conversations.get(chatId);
  history.push({ role, content });
  // trim to last MAX_HISTORY entries
  if (history.length > MAX_HISTORY) {
    conversations.set(chatId, history.slice(history.length - MAX_HISTORY));
  }
}

function clearHistory(chatId) {
  conversations.delete(chatId);
}

// ── OpenRouter Call ──────────────────────────────
async function askOpenRouter(messages) {
  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://fanz.my",
      "X-Title": "Fanz Customer Service Bot",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ── Supabase REST API ─────────────────────────────

const SUPABASE_HEADERS = SUPABASE_SERVICE_KEY
  ? { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" }
  : null;

// Query sales_records by invoice number (case-insensitive, trims whitespace)
async function lookupInvoice(invoiceNumber) {
  if (!SUPABASE_SERVICE_KEY) return null;
  const trimmed = (invoiceNumber || "").trim();
  if (!trimmed) return null;
  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/sales_records?invoice_number=ilike.*${encodeURIComponent(trimmed)}*&select=*`,
      { headers: SUPABASE_HEADERS }
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.error("Supabase lookupInvoice error:", err.message);
    return null;
  }
}

// Calculate warranty status from purchase date
// Warranty rule: placeholder — 10 years from purchase date (to be confirmed by boss)
function calcWarrantyStatus(purchaseDate) {
  const purchased = new Date(purchaseDate);
  const expires = new Date(purchased);
  expires.setFullYear(expires.getFullYear() + WARRANTY_YEARS);
  const now = new Date();
  return now < expires ? "in_warranty" : "out_of_warranty";
}

// Insert work order into Supabase
async function insertWorkOrder(data, warrantyStatus) {
  if (!SUPABASE_SERVICE_KEY) {
    console.warn("SUPABASE_SERVICE_KEY not set — skipping work order insert");
    return false;
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/work_orders`, {
      method: "POST",
      headers: SUPABASE_HEADERS,
      body: JSON.stringify({
        chat_id: data.chatId ? String(data.chatId) : "",
        model: data.model || "",
        issue: data.issue || "",
        invoice_number: data.invoice || "",
        warranty_status: warrantyStatus || "unknown",
        address: data.address || "",
        preferred_time: data.preferredTime || "",
        status: "new",
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`Supabase insertWorkOrder failed (${resp.status}):`, errText);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase insertWorkOrder error:", err.message);
    return false;
  }
}

// Insert complaint into Supabase
async function insertComplaint(chatId, category, content) {
  if (!SUPABASE_SERVICE_KEY) {
    console.warn("SUPABASE_SERVICE_KEY not set — skipping complaint insert");
    return false;
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/complaints`, {
      method: "POST",
      headers: SUPABASE_HEADERS,
      body: JSON.stringify({
        chat_id: String(chatId),
        category: category || "other",
        content: content || "",
        status: "new",
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`Supabase insertComplaint failed (${resp.status}):`, errText);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Supabase insertComplaint error:", err.message);
    return false;
  }
}

// ── Google Sheets (optional backup) ────────────────
async function appendToSheet(rowData) {
  if (!GOOGLE_SERVICE_ACCOUNT_JSON || !GOOGLE_SHEET_ID) {
    console.warn("Google Sheets not configured — skipping sheet append");
    return;
  }
  try {
    const { google } = require("googleapis");
    const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Sheet1!A:A",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rowData] },
    });
    console.log("Google Sheet append OK");
  } catch (err) {
    // Sheet failure: log only, do NOT block main flow
    console.error("Google Sheet append error (non-blocking):", err.message);
  }
}

// ── Localization ──────────────────────────────────
function detectLang(text) {
  return /[一-鿿]/.test(text || "") ? "zh" : "en";
}

const TRANSLATIONS = {
  warranty_in: {
    en: ({ model, date }) => `✅ Your fan (${model}, purchased ${date}) is within the 10-year warranty period.`,
    zh: ({ model, date }) => `✅ 您的吊扇 (${model}，购买日期 ${date}) 在 10 年保修期内。`,
  },
  warranty_out: {
    en: ({ model, date }) => `⚠️ Your fan (${model}, purchased ${date}) is outside the 10-year warranty period. Our team will provide a service quotation.`,
    zh: ({ model, date }) => `⚠️ 您的吊扇 (${model}，购买日期 ${date}) 已超过 10 年保修期。我们的团队将为您提供维修报价。`,
  },
  warranty_not_found: {
    en: "ℹ️ We could not find this invoice in our system. A colleague will manually verify your warranty status.",
    zh: "ℹ️ 系统中找不到此发票号码。我们的同事将手动核实您的保修状态。",
  },
  workorder_recorded: {
    en: "✅ Your repair request has been recorded. Our technician will contact you to arrange the visit.",
    zh: "✅ 您的维修申请已记录。我们的技术员将与您联系安排上门时间。",
  },
  workorder_busy: {
    en: "⚠️ System is temporarily busy. Your request has been forwarded to our human team who will follow up with you. Thank you for your patience.",
    zh: "⚠️ 系统暂时繁忙。您的申请已转交给我们的人工团队跟进。感谢您的耐心等待。",
  },
  complaint_busy: {
    en: "⚠️ System is temporarily busy. Your feedback has been forwarded to our human team who will personally follow up with you.",
    zh: "⚠️ 系统暂时繁忙。您的反馈已转交给我们的人工团队亲自跟进。",
  },
  error_connect: {
    en: "Sorry, I'm having trouble connecting right now. Please try again later.",
    zh: "抱歉，我现在连接出现问题，请稍后再试。",
  },
};

function tr(key, lang, params) {
  const entry = TRANSLATIONS[key];
  const value = entry[lang] || entry.en;
  return typeof value === "function" ? value(params || {}) : value;
}

// ── Parse AI response markers ──────────────────────
function parseMarker(reply) {
  const lines = reply.split("\n");
  const lastLine = lines[lines.length - 1].trim();

  const match = lastLine.match(/^\|\|DATA\|\|(.+)\|\|END\|\|\[(\w+)\]$/);
  if (!match) return { clean: reply, marker: null, data: null };

  try {
    const data = JSON.parse(match[1]);
    return {
      clean: lines.slice(0, -1).join("\n").trim(),
      marker: match[2], // WORKORDER_READY or COMPLAINT_READY
      data,
    };
  } catch {
    return { clean: reply, marker: null, data: null };
  }
}

// ── Welcome Message ──────────────────────────────
function buildWelcome() {
  return {
    zh: `您好！欢迎来到 Fanz Sdn Bhd 客服中心 🏠

我们是一家拥有10年经验的马来西亚吊扇公司，产品通过 SIRIM 认证和 Suruhanjaya Tenaga 批准。

请问您需要什么帮助？
1️⃣ 产品咨询 — 了解我们的吊扇系列
2️⃣ 报修/维修 — 预约上门维修
3️⃣ 投诉与反馈 — 分享您的意见

请在聊天框中直接告诉我您的问题，我会尽力协助您！如需人工客服，请随时告知。`,

    en: `Hello! Welcome to Fanz Sdn Bhd Customer Service 🏠

We are a 10-year-experienced Malaysian ceiling fan company with SIRIM certification and Suruhanjaya Tenaga approval.

How can I help you today?
1️⃣ Product Inquiry — Learn about our ceiling fan series
2️⃣ Repair / Maintenance — Schedule an on-site service
3️⃣ Complaint & Feedback — Share your thoughts

Just tell me your questions in the chat and I'll be happy to help! If you need a human agent, just let me know.`,
  };
}

// ── Bot Setup ────────────────────────────────────
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log("Fanz Customer Service Bot starting... (polling mode)");

// ── /start command ───────────────────────────────
bot.onText(/^\/start/, (msg) => {
  const chatId = msg.chat.id;
  clearHistory(chatId);

  const text = msg.text || "";
  // if user sent "/start en", show English only
  const wantsEnglish = text.toLowerCase().includes(" en");
  if (wantsEnglish) {
    bot.sendMessage(chatId, buildWelcome().en);
  } else {
    bot.sendMessage(chatId, buildWelcome().zh);
  }
});

// ── /clear command (debug / privacy) ─────────────
bot.onText(/\/clear/, (msg) => {
  const chatId = msg.chat.id;
  clearHistory(chatId);
  bot.sendMessage(chatId, "Conversation history cleared. / 对话记录已清除。");
});

// ── Message Handler ──────────────────────────────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  // Skip commands handled above
  if (text.startsWith("/")) return;

  // Ignore empty messages
  if (!text) return;

  // Show typing indicator
  bot.sendChatAction(chatId, "typing");

  try {
    // Build message array: system + history + current message
    const history = getHistory(chatId);
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: text },
    ];

    // Call OpenRouter
    const reply = await askOpenRouter(messages);

    // Save to history (original reply including marker)
    appendHistory(chatId, "user", text);
    appendHistory(chatId, "assistant", reply);

    // Parse marker from response
    const { clean, marker, data } = parseMarker(reply);

    // Detect language from current user message for localized system messages
    const lang = detectLang(text);

    // ── Process WORKORDER_READY marker ──────────────
    if (marker === "WORKORDER_READY" && data) {
      let warrantyMsg = "";
      let warrantyStatus = "unknown";

      // Look up invoice for warranty check
      if (data.invoice) {
        const record = await lookupInvoice(data.invoice.trim());
        if (record) {
          warrantyStatus = calcWarrantyStatus(record.purchase_date);
          warrantyMsg = tr(
            warrantyStatus === "in_warranty" ? "warranty_in" : "warranty_out",
            lang,
            { model: record.model, date: record.purchase_date }
          );
        } else {
          warrantyMsg = tr("warranty_not_found", lang);
        }
      }

      // Insert work order into Supabase
      const orderData = { ...data, chatId: String(chatId) };
      const inserted = await insertWorkOrder(orderData, warrantyStatus);

      // Append to Google Sheet (non-blocking, log-only on failure)
      appendToSheet([String(chatId), data.model, data.issue, data.invoice, warrantyStatus, data.address, data.preferredTime, new Date().toISOString()]);

      // Build final message
      let finalMsg = clean;
      if (warrantyMsg) finalMsg += "\n\n" + warrantyMsg + "\n\n" + tr("workorder_recorded", lang);

      if (!inserted) {
        finalMsg += "\n\n" + tr("workorder_busy", lang);
      }

      // Send reply (strip marker)
      await sendWithSplit(chatId, finalMsg);
      return;
    }

    // ── Process COMPLAINT_READY marker ──────────────
    if (marker === "COMPLAINT_READY" && data) {
      const inserted = await insertComplaint(chatId, data.category, data.content);

      let finalMsg = clean;
      if (!inserted) {
        finalMsg += "\n\n" + tr("complaint_busy", lang);
      }

      await sendWithSplit(chatId, finalMsg);
      return;
    }

    // ── No marker — send reply as-is ────────────────
    await sendWithSplit(chatId, reply);
  } catch (err) {
    console.error(`[chatId=${chatId}] Error:`, err.message);
    bot.sendMessage(chatId, tr("error_connect", detectLang(text)));
  }
});

// ── Helpers ──────────────────────────────────────
function splitMessage(text, maxLen = 4096) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    // Try to split at a newline within maxLen
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  return chunks;
}

async function sendWithSplit(chatId, text, options) {
  if (text.length <= 4096) {
    await bot.sendMessage(chatId, text, options);
  } else {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk, options);
    }
  }
}

// ── Graceful Shutdown ────────────────────────────
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  bot.stopPolling();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down...");
  bot.stopPolling();
  process.exit(0);
});