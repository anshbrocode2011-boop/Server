require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(x => x.trim()).filter(Boolean)
  : ["*"];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error("CORS: Origin not allowed"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "10mb" }));

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "My AI Gemini Backend", health: "/api/health" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", provider: "google-gemini", model: GEMINI_MODEL, apiKeyConfigured: Boolean(GEMINI_API_KEY) });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!genAI) return res.status(500).json({ success: false, error: "GEMINI_API_KEY is not configured on the server." });
    const { message, history = [], image } = req.body || {};
    if (!message && !image) return res.status(400).json({ success: false, error: "Message or image is required." });

    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: "You are a helpful AI assistant. Explain things clearly and simply. Help with school studies, coding, mathematics, science, business, technology and general questions. Show useful steps when solving problems and provide clean working code. Analyze uploaded images carefully."
    });

    const contents = [];
    if (Array.isArray(history)) {
      for (const item of history) {
        if (!item || !item.role || !item.content) continue;
        contents.push({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: String(item.content) }] });
      }
    }

    const parts = [];
    if (message) parts.push({ text: String(message) });
    if (image) {
      let mimeType = "image/jpeg", base64Data = image;
      if (image.startsWith("data:")) {
        const match = image.match(/^data:(.+?);base64,(.+)$/);
        if (match) { mimeType = match[1]; base64Data = match[2]; }
      }
      parts.push({ inlineData: { mimeType, data: base64Data } });
    }
    contents.push({ role: "user", parts });

    const result = await model.generateContent({
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 4096 }
    });
    const text = result.response.text();
    res.json({ success: true, response: text, provider: "google-gemini", model: GEMINI_MODEL });
  } catch (error) {
    console.error("Gemini API error:", error);
    const errorText = String(error?.message || error);
    let status = 500, message = "AI request failed.";
    if (errorText.includes("API key") || errorText.includes("401") || errorText.includes("403")) {
      status = 401; message = "Gemini API key is invalid or does not have access.";
    } else if (errorText.includes("429") || errorText.toLowerCase().includes("quota")) {
      status = 429; message = "Gemini API quota has been exceeded.";
    } else if (errorText.includes("404") || errorText.toLowerCase().includes("not found")) {
      status = 404; message = `Gemini model "${GEMINI_MODEL}" was not found.`;
    }
    res.status(status).json({ success: false, error: message, details: errorText });
  }
});

app.use((req, res) => res.status(404).json({ success: false, error: "Route not found" }));
app.use((err, req, res, next) => {
  console.error(err);
  if (err.message?.startsWith("CORS:")) return res.status(403).json({ success: false, error: err.message });
  res.status(500).json({ success: false, error: "Server error." });
});

app.listen(PORT, "0.0.0.0", () => console.log(`Gemini server running on port ${PORT}`));
