# Open-Source AI Chat Widget (Convex + OpenAI + Next.js)

Complete full-stack project with:
- Embeddable vanilla TypeScript widget (single bundle)
- Headless chat API for custom frontends (`/v1/chat`, `/v1/chat/stream`)
- Node.js backend API with OpenAI streaming
- Convex schema/functions for conversations and messages
- Next.js admin dashboard with password login
- Docker setup for local self-hosting

## Project Structure

```text
.
├── backend
│   ├── package.json
│   ├── src
│   │   ├── env.ts
│   │   └── server.ts
│   └── tsconfig.json
├── convex
│   ├── chat.ts
│   ├── conversations.ts
│   └── schema.ts
├── dashboard
│   ├── app
│   ├── components
│   ├── lib
│   ├── public
│   │   ├── headless-test.html
│   │   └── widget-test.html
│   ├── package.json
│   └── tsconfig.json
├── widget
│   ├── esbuild.config.mjs
│   ├── package.json
│   ├── src
│   │   └── index.ts
│   └── tsconfig.json
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Prerequisites

- Node.js 20+
- npm 10+
- Convex account/project
- OpenAI API key

## 1) Configure Environment

```bash
cp .env.example .env
```

Set required values in `.env`:
- `CONVEX_URL`
- `OPENAI_API_KEY`
- `WIDGET_API_KEY`
- `DASHBOARD_PASSWORD`

Optional:
- `ADMIN_API_KEY` (required only for `/v1/admin/*` endpoints)

## 2) Install Dependencies

```bash
npm install
```

## 3) Run Convex (functions + DB)

Generate Convex types once:

```bash
npm run codegen
```

Run Convex dev:

```bash
npm run dev:convex
```

## 4) Run All Services in Dev

In another terminal:

```bash
npm run dev
```

Services:
- Backend: `http://localhost:4000`
- Dashboard: `http://localhost:3000`
- Widget bundle: `http://localhost:4000/widget/chat-widget.js`

## 5) Test Pages

- Widget test page: `http://localhost:3000/widget-test.html`
- Headless API test page: `http://localhost:3000/headless-test.html`

## 6) Embed Widget

```html
<script
  src="http://localhost:4000/widget/chat-widget.js"
  data-api-url="http://localhost:4000/chat"
  data-api-key="change-me-widget-key"
  data-title="Support"
  data-welcome-message="Hey! How can I help?"
  data-input-placeholder="Type your question..."
  data-position="right"
  data-accent-color="#0ea5e9"
  defer
></script>
```

## API

### Base endpoints

- `GET /health`
- `GET /widget/chat-widget.js`
- `GET /v1/openapi.json`

### Chat endpoints

- `POST /chat` (legacy widget-compatible streaming alias)
- `POST /v1/chat` (headless JSON response)
- `POST /v1/chat/stream` (headless NDJSON stream)

Chat auth headers (either works):
- `x-widget-api-key: <WIDGET_API_KEY>`
- `x-api-key: <WIDGET_API_KEY>`

Chat body:

```json
{
  "sessionId": "string",
  "message": "string"
}
```

`POST /v1/chat` response:

```json
{
  "conversationId": "...",
  "message": "..."
}
```

`POST /v1/chat/stream` response events (NDJSON):
- `{"type":"start","conversationId":"..."}`
- `{"type":"token","token":"..."}`
- `{"type":"done","message":"...","conversationId":"..."}`
- `{"type":"error","error":"..."}`

### Admin conversation endpoints

Requires header:
- `x-admin-api-key: <ADMIN_API_KEY>`

Endpoints:
- `GET /v1/admin/conversations?limit=100`
- `GET /v1/admin/conversations/:conversationId`

## Headless Frontend Example (No Widget)

Non-streaming:

```ts
await fetch("https://<backend-domain>/v1/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "<WIDGET_API_KEY>"
  },
  body: JSON.stringify({
    sessionId: "my-session-id",
    message: "Hello"
  })
});
```

Streaming:

```ts
await fetch("https://<backend-domain>/v1/chat/stream", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "<WIDGET_API_KEY>"
  },
  body: JSON.stringify({
    sessionId: "my-session-id",
    message: "Hello"
  })
});
```

## Dashboard Login

- URL: `http://localhost:3000/login`
- Password: `DASHBOARD_PASSWORD`

## Docker

```bash
docker compose up --build
```

Services:
- Backend: `http://localhost:4000`
- Dashboard: `http://localhost:3000`

## Deployment Setup

Recommended architecture per adopter:
- 1 Convex project
- 1 backend deployment
- 1 dashboard deployment (optional)
- Any website/app embedding widget or calling headless API

### Convex

```bash
npx convex deploy
```

### Backend deployment (Render/Railway/Fly/Node host)

Use repo root.

Build command:

```bash
npm install --include=dev && npm run build:backend
```

Start command:

```bash
npm run start:backend
```

Backend env vars:
- `NODE_ENV=production`
- `CONVEX_URL=https://<your-production>.convex.cloud`
- `OPENAI_API_KEY=<your-openai-key>`
- `OPENAI_MODEL=gpt-4.1-mini`
- `WIDGET_API_KEY=<strong-random-secret>`
- `ADMIN_API_KEY=<strong-random-secret>` (optional, needed for `/v1/admin/*`)
- `CORS_ORIGIN=https://your-site.com,https://your-dashboard-domain.com`
- `PORT=4000`

### Dashboard deployment (Vercel)

- Root Directory: `dashboard`
- Framework: Next.js

Dashboard env vars:
- `CONVEX_URL=https://<your-production>.convex.cloud`
- `DASHBOARD_PASSWORD=<strong-random-password>`
- `NEXT_PUBLIC_BACKEND_URL=https://<your-backend-domain>`

### Production smoke tests

- `GET https://<backend>/health` returns `{"status":"ok"}`
- `GET https://<backend>/widget/chat-widget.js` returns JavaScript
- `POST https://<backend>/v1/chat` returns JSON reply
- `POST https://<backend>/v1/chat/stream` streams NDJSON
- `GET https://<backend>/v1/openapi.json` returns OpenAPI document
- Dashboard login works at `/login`

## Security Notes

- Rotate `WIDGET_API_KEY`, `ADMIN_API_KEY`, and `DASHBOARD_PASSWORD`.
- Keep `OPENAI_API_KEY` server-side only.
- Restrict `CORS_ORIGIN` to trusted domains. In production, `*` is rejected.
- Serve backend and dashboard over HTTPS.
- Backend includes rate limiting (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`).
- API key/password checks use timing-safe comparison.
- Security headers are enabled (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production).
