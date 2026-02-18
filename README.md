# Open-Source AI Chat Widget (Convex + OpenAI + Next.js)

Complete full-stack project with:
- Embeddable vanilla TypeScript widget (single bundle)
- Node.js backend API for `/chat` with OpenAI streaming
- Convex database schema/functions for conversations and messages
- Next.js admin dashboard with static-password login
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
│   │   ├── api
│   │   │   ├── login
│   │   │   │   └── route.ts
│   │   │   └── logout
│   │   │       └── route.ts
│   │   ├── conversations
│   │   │   └── [id]
│   │   │       └── page.tsx
│   │   ├── login
│   │   │   └── page.tsx
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components
│   │   └── login-form.tsx
│   ├── lib
│   │   ├── auth.ts
│   │   └── convex.ts
│   ├── next-env.d.ts
│   ├── next.config.mjs
│   ├── package.json
│   └── tsconfig.json
├── widget
│   ├── esbuild.config.mjs
│   ├── package.json
│   ├── src
│   │   └── index.ts
│   └── tsconfig.json
├── .dockerignore
├── .env.example
├── .gitignore
├── convex.json
├── docker-compose.yml
├── Dockerfile
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

## 2) Install Dependencies

```bash
npm install
```

## 3) Run Convex (functions + DB)

Generate Convex types once:

```bash
npm run codegen
```

Then run Convex in dev mode:

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

## 5) Embed Widget

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

### `POST /chat`
Headers:
- `Content-Type: application/json`
- `x-widget-api-key: <WIDGET_API_KEY>`

Body:

```json
{
  "sessionId": "string",
  "message": "string"
}
```

Response: NDJSON stream with events:
- `{"type":"start", ...}`
- `{"type":"token", ...}`
- `{"type":"done", ...}`
- `{"type":"error", ...}`

## Dashboard Login

- URL: `http://localhost:3000/login`
- Password: `DASHBOARD_PASSWORD`

## Docker

Build and run backend + dashboard:

```bash
docker compose up --build
```

Services:
- Backend: `http://localhost:4000`
- Dashboard: `http://localhost:3000`

Make sure your `.env` is configured and reachable by containers.

## Deployment Setup (Open-Source Usage)

Recommended architecture for each adopter:
- One Convex project per deployment (database + functions).
- One backend deployment (serves `/chat` + `/widget/chat-widget.js`).
- One dashboard deployment (optional, for conversation viewing).
- Embed script added to any external website.

### 1) Push repo to GitHub

- Push this codebase to your own GitHub repo.

### 2) Create Convex production deployment

From repo root:

```bash
npx convex deploy
```

Copy your production Convex URL (looks like `https://<name>.convex.cloud`).

### 3) Deploy backend (example: Render/Railway/Fly/any Node host)

Use repo root as the app root.

Build command:

```bash
npm install && npm run build:backend
```

Start command:

```bash
npm run start:backend
```

Set backend environment variables:
- `NODE_ENV=production`
- `CONVEX_URL=https://<your-production>.convex.cloud`
- `OPENAI_API_KEY=<your-openai-key>`
- `OPENAI_MODEL=gpt-4.1-mini` (or your preferred model)
- `WIDGET_API_KEY=<strong-random-secret>`
- `DASHBOARD_PASSWORD=<strong-random-password>`
- `CORS_ORIGIN=https://your-site.com,https://your-dashboard-domain.com`
- `WIDGET_BUNDLE_PATH=../widget/dist/chat-widget.js`

### 4) Deploy dashboard (example: Vercel)

Import the same GitHub repo into Vercel:
- Root Directory: `dashboard`
- Framework: Next.js

Set dashboard environment variables:
- `CONVEX_URL=https://<your-production>.convex.cloud`
- `DASHBOARD_PASSWORD=<same-admin-password>`
- `NEXT_PUBLIC_BACKEND_URL=https://<your-backend-domain>`

### 5) Embed widget on any website

```html
<script
  src="https://<your-backend-domain>/widget/chat-widget.js"
  data-api-url="https://<your-backend-domain>/chat"
  data-api-key="<your-widget-api-key>"
  data-title="Support"
  data-welcome-message="Hi! How can I help?"
  data-input-placeholder="Type your question..."
  data-position="right"
  data-accent-color="#0ea5e9"
  defer
></script>
```

### 6) Production smoke tests

- `GET https://<backend-domain>/health` returns `{"status":"ok"}`.
- `POST https://<backend-domain>/chat` with valid `x-widget-api-key` streams NDJSON.
- Dashboard login works at `/login`.
- New widget message appears in dashboard conversations.

## Security Notes

- Rotate `WIDGET_API_KEY` and `DASHBOARD_PASSWORD` regularly.
- Keep `OPENAI_API_KEY` server-side only.
- Restrict `CORS_ORIGIN` to known domains only. In production, `*` is rejected.
- Serve backend and dashboard over HTTPS.
- Backend includes request-rate limiting (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`).
- API key and dashboard password checks use timing-safe comparison.
- Security headers are set on backend and dashboard responses (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production).
