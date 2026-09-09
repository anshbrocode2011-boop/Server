# My AI — Backend (Gemini-only)

Node.js + Express backend for the My AI project. Deploys to Render.

## Deploy to Render

### Option A — Blueprint (recommended)

1. Push this repo to GitHub.
2. Render → New → Blueprint → connect this repo.
3. Render reads `render.yaml` and creates the service automatically.
4. Fill in the requested secrets:
   - `GEMINI_API_KEY` — your Google Gemini API key
   - `ALLOWED_ORIGINS` — your frontend URL, e.g. `https://my-ai-website1.netlify.app` (no trailing slash)
5. Deploy.

### Option B — Manual web service

1. Render → New → Web Service → connect this repo.
2. Root Directory: leave blank (this repo's root is the backend).
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Environment variables:
   ```
   GEMINI_API_KEY=your_google_gemini_api_key
   GEMINI_MODEL=gemini-flash-latest
   ALLOWED_ORIGINS=https://my-ai-website1.netlify.app
   ```
6. Deploy.

## Verify it worked

- Visit `https://<your-service>.onrender.com/` — should return `{"status":"ok", ...}`
- Visit `https://<your-service>.onrender.com/api/health`
- Check the Render **Logs** tab on startup — you should see:
  ```
  [cors] Allowed origins: [ 'https://my-ai-website1.netlify.app' ]
  ```
  If you don't see this exact log line, the old code is still deployed somehow — double-check the repo actually has this `server.js`.

## Notes

- `ALLOWED_ORIGINS` also automatically allows Netlify deploy-preview subdomains of any listed `*.netlify.app` origin.
- `GEMINI_MODEL=gemini-flash-latest` tracks Google's current stable Flash model automatically, so it won't break when Google retires a specific version.
- Never commit a real `.env` file or your API key — `.env.example` is a template only.
