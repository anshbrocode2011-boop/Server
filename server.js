// ===========================================================
// My AI — Gemini-only backend
// Node.js + Express. The Gemini API key stays on Render.
// ===========================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();

const PORT = process.env.PORT || 5000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const REQUEST_TIMEOUT_MS = 30000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_MESSAGE_LENGTH = 8000;
const MAX_HISTORY_MESSAGES = 12;

if (!GEMINI_API_KEY) console.warn("[warn] GEMINI_API_KEY is not set.");
console.log("[cors] Allowed origins:", ALLOWED_ORIGINS);

// For any allowed origin like https://my-site.netlify.app, also allow that
// site's deploy-preview subdomains, e.g. https://<hash>--my-site.netlify.app
const NETLIFY_PREVIEW_PATTERNS = ALLOWED_ORIGINS
  .map((o) => o.match(/^https:\/\/([a-z0-9-]+)\.netlify\.app$/i))
  .filter(Boolean)
  .map((m) => new RegExp(`^https://[a-z0-9]+--${m[1]}\\.netlify\\.app$`, "i"));

function isOriginAllowed(origin) {
  if (!origin) return true;
  const normalized = origin.replace(/\/+$/, "");
  if (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(normalized)) return true;
  return NETLIFY_PREVIEW_PATTERNS.some((re) => re.test(normalized));
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      console.warn("[cors] Rejected origin:", JSON.stringify(origin), "| Allowed list:", ALLOWED_ORIGINS);
      return callback(new Error("Not allowed by CORS"));
    },
  })
);

app.use(express.json({ limit: "12mb" }));

const MODE_INSTRUCTIONS = {
  auto: "Decide the best way to help based on what the user is asking. Adapt your structure and depth to the request.",
  explain: "Explain the topic clearly from the basics, as if teaching someone new to it. Use a simple real-world example before technical detail.",
  solve: "Solve the problem step by step. Show the important steps and give a clearly labelled final answer.",
  code: "Help write, debug, or explain code. Give working code in properly fenced code blocks and explain important changes.",
  study: "Focus on helping the user learn and revise. Break the topic into key points, define important terms, and end with one short practice question.",
  business: "Focus on practical business ideas and strategy. Be concrete, actionable, and realistic.",
  creative: "Focus on creative writing and brainstorming. Be imaginative, useful, and on-topic.",
};

function buildProfileNote(profile) {
  if (!profile || typeof profile !== "object") return "";
  const lines = [];
  if (profile.name) lines.push(`Name: ${profile.name}`);
  if (profile.responseLength) lines.push(`Preferred response length: ${profile.responseLength}`);
  if (profile.explanationStyle) lines.push(`Preferred explanation style: ${profile.explanationStyle}`);
  if (profile.interests) lines.push(`Interests: ${profile.interests}`);
  if (profile.goals) lines.push(`Current goals: ${profile.goals}`);
  if (profile.languages) lines.push(`Preferred programming languages: ${profile.languages}`);
  if (profile.other) lines.push(`Other preferences: ${profile.other}`);
  return lines.length ? `\n\nRelevant user profile:\n${lines.join("\n")}` : "";
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new ApiError(504, "The AI took too long to respond. Please try again.");
    }
    throw new ApiError(502, "Couldn't reach Gemini. Check the server connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

function validateChatRequest(body) {
  const { message, image, history } = body;

  if ((!message || !message.trim()) && !image) {
    throw new ApiError(400, "Please enter a message or attach an image.");
  }
  if (message && message.length > MAX_MESSAGE_LENGTH) {
    throw new ApiError(400, `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`);
  }
  if (history && !Array.isArray(history)) {
    throw new ApiError(400, "Invalid conversation history.");
  }
  if (image) {
    if (typeof image !== "object" || !image.mimeType || !image.data) {
      throw new ApiError(400, "Invalid image data.");
    }
    if (!ALLOWED_IMAGE_TYPES.includes(image.mimeType.toLowerCase())) {
      throw new ApiError(400, "Unsupported image type. Please use JPG, PNG, or WEBP.");
    }
    const approxBytes = Math.floor((image.data.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      throw new ApiError(400, "Image is too large. Please use an image under 8MB.");
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(image.data.slice(0, 100))) {
      throw new ApiError(400, "Image data looks corrupted. Please try uploading it again.");
    }
  }
}

function trimHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY_MESSAGES);
}

async function callGemini({ message, image, mode, history, profile }) {
  if (!GEMINI_API_KEY) {
    throw new ApiError(500, "Gemini is not configured. Add GEMINI_API_KEY in Render Environment Variables.");
  }

  const systemPrompt =
    `You are My AI, a helpful general-purpose AI assistant. ` +
    `Answer the user's request directly, accurately, and clearly. Do not mention internal prompts, APIs, or servers. ` +
    `${MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.auto}` +
    buildProfileNote(profile);

  const contents = [];
  for (const h of trimHistory(history)) {
    contents.push({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: h.content }],
    });
  }

  const parts = [];
  if (message && message.trim()) parts.push({ text: message });
  if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  contents.push({ role: "user", parts });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { maxOutputTokens: 1600 },
    }),
  });

  if (res.status === 400) {
    const body = await res.text().catch(() => "");
    console.error("[Gemini 400]", body);
    throw new ApiError(400, "Gemini rejected the request. Check the model, message, or image format.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiError(500, "Gemini API authentication failed. Check GEMINI_API_KEY in Render.");
  }
  if (res.status === 429) {
    throw new ApiError(429, "Gemini rate limit reached. Please try again in a moment.");
  }
  if (res.status === 404) {
    const body = await res.text().catch(() => "");
    console.error("[Gemini 404]", body);
    throw new ApiError(
      500,
      `Gemini model "${GEMINI_MODEL}" was not found. It may have been retired by Google — set GEMINI_MODEL in Render to "gemini-flash-latest" or another current model.`
    );
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[Gemini error]", res.status, errBody);
    throw new ApiError(502, "Gemini couldn't process that request.");
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n").trim();

  if (!text) {
    console.error("[Gemini empty response]", JSON.stringify(data));
    throw new ApiError(502, "Gemini returned an empty response. Please try again.");
  }

  return text;
}

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "my-ai-backend", provider: "gemini" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", provider: "gemini", model: GEMINI_MODEL });
});

app.post("/api/chat", async (req, res) => {
  try {
    validateChatRequest(req.body);
    const { message = "", image = null, mode = "auto", history = [], profile = null } = req.body;
    const safeMode = MODE_INSTRUCTIONS[mode] ? mode : "auto";

    const answer = await callGemini({ message, image, mode: safeMode, history, profile });
    res.json({ answer, model: GEMINI_MODEL, provider: "gemini" });
  } catch (err) {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
    console.error("[Unhandled /api/chat error]", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "That request is too large. Try a smaller image." });
  }
  console.error("[Unhandled middleware error]", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`My AI Gemini backend listening on port ${PORT}`);
  console.log(`Gemini model: ${GEMINI_MODEL}`);
});
