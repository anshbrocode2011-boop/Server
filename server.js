import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use(
  cors({
    origin: "*"
  })
);

app.use(
  express.json({
    limit: "10mb"
  })
);

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
// OPENAI
// -----------------------------

async function askOpenAI(message, history = []) {
  const conversation = history
    .map((item) => {
      return `${item.role}: ${item.content}`;
    })
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

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL,
    input: prompt
  });

  return response.output_text;
}

// -----------------------------
// GEMINI
// -----------------------------

async function askGemini(message, history = []) {
  const conversation = history
    .map((item) => {
      return `${item.role}: ${item.content}`;
    })
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

  const response = await gemini.models.generateContent({
    model: process.env.GEMINI_MODEL,
    contents: prompt
  });

  return response.text;
}

// -----------------------------
// FINAL SYNTHESIS
// -----------------------------

async function createFinalAnswer(
  message,
  openaiAnswer,
  geminiAnswer
) {
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

  const response = await openai.responses.create({
    model: process.env.FINAL_MODEL,
    input: prompt
  });

  return response.output_text;
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
    const {
      message,
      history = [],
      mode = "auto"
    } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    console.log("User:", message);
    console.log("Mode:", mode);

    // Run both models at the same time
    const [openaiAnswer, geminiAnswer] =
      await Promise.all([
        askOpenAI(message, history),
        askGemini(message, history)
      ]);

    console.log("OpenAI analysis completed");
    console.log("Gemini analysis completed");

    // Final synthesis
    const finalAnswer = await createFinalAnswer(
      message,
      openaiAnswer,
      geminiAnswer
    );

    res.json({
      answer: finalAnswer,

      // Useful for debugging.
      // Remove these in production if you don't want
      // the frontend to receive internal analyses.
      analysis: {
        openai: openaiAnswer,
        gemini: geminiAnswer
      }
    });

  } catch (error) {
    console.error("API ERROR:", error);

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
