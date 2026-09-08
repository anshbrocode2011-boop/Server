# My AI Gemini Backend - Render Ready

Render settings:
- Root Directory: blank
- Build Command: npm install
- Start Command: npm start

Environment variables:
- GEMINI_API_KEY = your Google Gemini API key
- GEMINI_MODEL = gemini-2.5-flash
- ALLOWED_ORIGINS = optional; leave unset for testing

Health test:
https://server-3-ogdd.onrender.com/api/health

Chat endpoint:
POST https://server-3-ogdd.onrender.com/api/chat
