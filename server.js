import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Models (fallbacks)
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
const DEFAULT_FINAL_MODEL = process.env.FINAL_MODEL || DEFAULT_OPENAI_MODEL;
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "models/text-bison-001";

// -----------------------------
// API CLIENTS
// -----------------------------

if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️ OPENAI_API_KEY is missing");
}
if (!process.env.GEMINI_API_KEY) {
  console.warn("⚠️ GEMINI_API_KEY is missing");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

// -----------------------------
// MIDDLEWARE
// -----------------------------

app.use(helmet());

const corsOrigin = process.env.CORS_ORIGIN || "*"; // set CORS_ORIGIN in production to the frontend URL
app.use(
  cors({
    origin: corsOrigin
  })
);

app.use(
  express.json({
    limit: "10mb"
  })
);

// Basic rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: Number(process.env.RATE_LIMIT_MAX) || 60, // per IP
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// -----------------------------
// PERSONAL AI PROMPT
// -----------------------------

const SYSTEM_PROMPT = `
You are a highly intelligent personal AI assistant.

Your job is to help the user with:
- Study
- Mathematics
- Science
- Coding
- Programming
- Business
- Research
- Writing
- Problem solving
- Brainstorming
- Planning
- Creative tasks
- General questions
- Image understanding

Be friendly, clear and practical.

Explain difficult concepts simply.

Do not blindly agree with the user.
If something is incorrect, explain the correction.

For mathematical and technical problems:
- Understand the problem
- Explain the method
- Show important steps
- Verify the result
- Give the final answer clearly

Your goal is to help the user understand the answer rather than simply giving an answer.
`;

// -----------------------------
// Helpers to extract text safely
// -----------------------------

function extractOpenAIText(resp) {
  if (!resp) return "";
  // SDKs differ — try common shapes
  if (typeof resp.output_text === "string") return resp.output_text;
  if (typeof resp.output === "string") return resp.output;
  if (Array.isArray(resp.output)) {
    // output might be array of objects or strings
    return resp.output
      .map((o) => {
        if (typeof o === "string") return o;
        if (o.content) {
          if (typeof o.content === "string") return o.content;
          if (Array.isArray(o.content)) {
            return o.content.map((c) => c.text || c).join("");
          }
        }
        // try nested text fields
        if (o.delta && o.delta.content) return o.delta.content;
        return "";
      })
      .join("\n")
      .trim();
  }
  // fallback to stringifying small responses
  try {
    return JSON.stringify(resp).slice(0, 10000);
  } catch {
    return "";
  }
}

function extractGeminiText(resp) {
  if (!resp) return "";
  if (typeof resp.text === "string") return resp.text;
  if (typeof resp.output_text === "string") return resp.output_text;
  // google genai sometimes returns candidates or content array
  if (Array.isArray(resp.candidates)) {
    return resp.candidates.map((c) => c.content || c.text || "").join("\n").trim();
  }
  if (Array.isArray(resp.outputs)) {
    return resp.outputs.map((o) => o.text || o.content || "").join("\n").trim();
  }
  try {
    return JSON.stringify(resp).slice(0, 10000);
  } catch {
    return "";
  }
}

// -----------------------------
// OPENAI
// -----------------------------

async function askOpenAI(message, history = []) {
  const conversation = history
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n");

  const prompt = `
${SYSTEM_PROMPT}

Previous conversation:
${conversation || "No previous conversation."}

User request:
${message}

Analyze this request independently.
Give a detailed but useful analysis that another AI can review.
`;

  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      input: prompt
    });

    return extractOpenAIText(response);
  } catch (err) {
    console.error("OpenAI request failed:", err?.message || err);
    return `OpenAI error: ${err?.message || "unknown"}`;
  }
}

// -----------------------------
// GEMINI
// -----------------------------

async function askGemini(message, history = []) {
  const conversation = history
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n");

  const prompt = `
${SYSTEM_PROMPT}

Previous conversation:
${conversation || "No previous conversation."}

User request:
${message}

Analyze this request independently.

Look for:
- Mistakes
- Alternative solutions
- Important details
- Better explanations
- Practical suggestions

Do not blindly follow another model's assumptions.
`;

  try {
    const response = await gemini.models.generateContent({
      model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      contents: prompt
    });

    return extractGeminiText(response);
  } catch (err) {
    console.error("Gemini request failed:", err?.message || err);
    return `Gemini error: ${err?.message || "unknown"}`;
  }
}

// -----------------------------
// FINAL SYNTHESIS
// -----------------------------

async function createFinalAnswer(message, openaiAnswer, geminiAnswer) {
  const prompt = `
${SYSTEM_PROMPT}

You are the final answer generator.

USER REQUEST:
${message}

OPENAI ANALYSIS:
${openaiAnswer}

GEMINI ANALYSIS:
${geminiAnswer}

Compare both analyses carefully.

Your job is to:
1. Find the strongest information.
2. Identify contradictions.
3. Correct obvious mistakes.
4. Avoid duplicated information.
5. Produce ONE final answer.
6. Make the answer easy to understand.
7. Give practical steps when appropriate.

Do not mention that you are comparing models.

Return only the final response for the user.
`;

  try {
    const response = await openai.responses.create({
      model: process.env.FINAL_MODEL || DEFAULT_FINAL_MODEL,
      input: prompt
    });

    return extractOpenAIText(response);
  } catch (err) {
    console.error("Final synthesis failed:", err?.message || err);
    return `Final synthesis error: ${err?.message || "unknown"}`;
  }
}

// -----------------------------
// HEALTH CHECK
// -----------------------------

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Personal AI backend is running"
  });
});

// -----------------------------
// CHAT API
// -----------------------------

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [], mode = "auto" } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!Array.isArray(history)) {
      return res.status(400).json({ error: "History must be an array" });
    }

    console.info("User request length:", message.length);
    console.debug("Mode:", mode);

    // Run both models at the same time
    const [openaiAnswer, geminiAnswer] = await Promise.all([
      askOpenAI(message, history),
      askGemini(message, history)
    ]);

    console.info("Model analyses completed");

    // Final synthesis
    const finalAnswer = await createFinalAnswer(message, openaiAnswer, geminiAnswer);

    const payload = { answer: finalAnswer };

    // Only include analyses when not in production
    if (process.env.NODE_ENV !== "production") {
      payload.analysis = {
        openai: openaiAnswer,
        gemini: geminiAnswer
      };
    }

    res.json(payload);
  } catch (error) {
    console.error("API ERROR:", error?.message || error);
    res.status(500).json({
      error: "AI request failed",
      message: "Please try again later."
    });
  }
});

// -----------------------------
// START SERVER
// -----------------------------

app.listen(PORT, () => {
  console.log(`
====================================
   PERSONAL AI BACKEND
====================================

Server running on:
http://localhost:${PORT}

Health:
http://localhost:${PORT}/api/health

Chat:
POST http://localhost:${PORT}/api/chat
`);
});
