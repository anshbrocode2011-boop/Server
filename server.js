require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY is missing");
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((x) => x.trim())
  : ["*"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes("*")) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("CORS: Origin not allowed"));
    },
  })
);

app.use(express.json({ limit: "10mb" }));

const genAI = GEMINI_API_KEY
  ? new GoogleGenerativeAI(GEMINI_API_KEY)
  : null;

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    provider: "google-gemini",
    model: GEMINI_MODEL,
  });
});

// Chat
app.post("/api/chat", async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({
        error: "Gemini API key is not configured on the server.",
      });
    }

    const { message, history = [], image } = req.body;

    if (!message && !image) {
      return res.status(400).json({
        error: "Message or image is required.",
      });
    }

    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: `
You are a helpful AI assistant.

Explain things clearly and simply.
Help with:
- School studies
- Coding
- Mathematics
- Science
- Business
- Technology
- General questions

When solving problems, show useful steps.
When writing code, provide clean and working code.
If the user uploads an image, analyze the image carefully.
      `,
    });

    const contents = [];

    // Previous conversation
    if (Array.isArray(history)) {
      for (const item of history) {
        if (!item || !item.role || !item.content) continue;

        contents.push({
          role: item.role === "assistant" ? "model" : "user",
          parts: [{ text: String(item.content) }],
        });
      }
    }

    // Current message
    const parts = [];

    if (message) {
      parts.push({
        text: String(message),
      });
    }

    // Optional base64 image
    if (image) {
      let mimeType = "image/jpeg";
      let base64Data = image;

      if (image.startsWith("data:")) {
        const match = image.match(/^data:(.+?);base64,(.+)$/);

        if (match) {
          mimeType = match[1];
          base64Data = match[2];
        }
      }

      parts.push({
        inlineData: {
          mimeType,
          data: base64Data,
        },
      });
    }

    contents.push({
      role: "user",
      parts,
    });

    const result = await model.generateContent({
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
      },
    });

    const response = result.response;
    const text = response.text();

    return res.json({
      success: true,
      response: text,
      provider: "google-gemini",
      model: GEMINI_MODEL,
    });
  } catch (error) {
    console.error("Gemini API error:", error);

    let status = 500;
    let message = "AI request failed.";

    const errorText = String(error?.message || error);

    if (
      errorText.includes("API key") ||
      errorText.includes("401") ||
      errorText.includes("403")
    ) {
      status = 401;
      message = "Gemini API key is invalid or does not have access.";
    } else if (
      errorText.includes("429") ||
      errorText.toLowerCase().includes("quota")
    ) {
      status = 429;
      message = "Gemini API quota has been exceeded.";
    } else if (
      errorText.includes("404") ||
      errorText.toLowerCase().includes("not found")
    ) {
      status = 404;
      message = `Gemini model "${GEMINI_MODEL}" was not found.`;
    }

    return res.status(status).json({
      success: false,
      error: message,
      details: errorText,
    });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);

  if (err.message?.startsWith("CORS:")) {
    return res.status(403).json({
      error: err.message,
    });
  }

  res.status(500).json({
    error: "Server error.",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Gemini server running on port ${PORT}`);
  console.log(`🤖 Model: ${GEMINI_MODEL}`);
});
