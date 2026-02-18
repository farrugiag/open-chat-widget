import { existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import cors, { type CorsOptions } from "cors";
import express, { Request, Response } from "express";
import { z } from "zod";
import { env } from "./env.js";

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatStreamPayload =
  | { type: "start"; conversationId: string }
  | { type: "token"; token: string }
  | { type: "done"; message: string; conversationId: string }
  | { type: "error"; error: string };

type OpenAIChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const app = express();
const convex = new ConvexHttpClient(env.CONVEX_URL);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, "..");
const widgetBundlePath = path.isAbsolute(env.WIDGET_BUNDLE_PATH)
  ? env.WIDGET_BUNDLE_PATH
  : path.resolve(backendDir, env.WIDGET_BUNDLE_PATH);

const configuredOrigins = env.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowAllOrigins = configuredOrigins.includes("*");
const allowedOriginSet = new Set(configuredOrigins.filter((origin) => origin !== "*"));

if (env.NODE_ENV === "production" && allowAllOrigins) {
  throw new Error("Refusing to start with CORS_ORIGIN='*' in production.");
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();

function getClientIp(req: Request): string {
  const forwardedFor = req.header("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return req.ip || req.socket.remoteAddress || "unknown";
}

function isWithinRateLimit(req: Request): boolean {
  const key = getClientIp(req);
  const now = Date.now();
  const existing = rateLimitBuckets.get(key);

  if (!existing || now > existing.resetAt) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + env.RATE_LIMIT_WINDOW_MS
    });
    return true;
  }

  existing.count += 1;
  return existing.count <= env.RATE_LIMIT_MAX_REQUESTS;
}

function isValidWidgetApiKey(apiKey: string): boolean {
  const expected = Buffer.from(env.WIDGET_API_KEY);
  const received = Buffer.from(apiKey);

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}

const corsOrigin: CorsOptions["origin"] = (origin, callback) => {
  if (!origin) {
    callback(null, true);
    return;
  }

  if (allowAllOrigins || allowedOriginSet.has(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error("Blocked by CORS policy"));
};

app.disable("x-powered-by");

app.use(
  cors({
    origin: corsOrigin,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-widget-api-key"]
  })
);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(express.json({ limit: "2mb" }));

const chatRequestSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  message: z.string().min(1).max(4000)
});

function writeStreamLine(res: Response, payload: ChatStreamPayload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

app.get("/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
});

app.get("/widget/chat-widget.js", (_req, res) => {
  if (!existsSync(widgetBundlePath)) {
    res.status(404).json({
      error: "Widget bundle not found. Build the widget with `npm run build --workspace widget`."
    });
    return;
  }

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    env.NODE_ENV === "production" ? "public, max-age=300, immutable" : "no-store"
  );
  res.sendFile(widgetBundlePath);
});

app.post("/chat", async (req: Request, res: Response) => {
  if (!isWithinRateLimit(req)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const apiKey = req.header("x-widget-api-key");

  if (!apiKey || !isValidWidgetApiKey(apiKey)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = chatRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    if (env.NODE_ENV === "development") {
      res.status(400).json({ error: "Invalid request payload", details: parsed.error.flatten() });
      return;
    }

    res.status(400).json({ error: "Invalid request payload" });
    return;
  }

  const { sessionId, message } = parsed.data;

  try {
    const now = Date.now();
    const conversationId = await convex.mutation(anyApi.conversations.getOrCreateConversation, {
      sessionId,
      now
    });

    await convex.mutation(anyApi.conversations.addMessage, {
      conversationId,
      role: "user",
      content: message,
      createdAt: now
    });

    const history = (await convex.query(anyApi.conversations.getHistoryForModel, {
      conversationId,
      limit: env.MAX_HISTORY_MESSAGES
    })) as HistoryMessage[];

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    writeStreamLine(res, { type: "start", conversationId: String(conversationId) });

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        stream: true,
        messages: [
          {
            role: "system",
            content:
              "You are a concise and helpful AI assistant embedded in a support chat widget."
          },
          ...history.map((item) => ({ role: item.role, content: item.content }))
        ]
      })
    });

    if (!openAiResponse.ok || !openAiResponse.body) {
      const details = await openAiResponse.text();
      throw new Error(`OpenAI request failed (${openAiResponse.status}): ${details}`);
    }

    const reader = openAiResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantMessage = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const boundary = buffer.indexOf("\n\n");

        if (boundary === -1) {
          break;
        }

        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const rawLine of rawEvent.split("\n")) {
          const line = rawLine.trim();

          if (!line.startsWith("data:")) {
            continue;
          }

          const data = line.slice(5).trim();

          if (data === "[DONE]") {
            continue;
          }

          let parsed: OpenAIChatCompletionChunk;
          try {
            parsed = JSON.parse(data) as OpenAIChatCompletionChunk;
          } catch {
            continue;
          }

          const token = parsed.choices?.[0]?.delta?.content;

          if (!token) {
            continue;
          }

          assistantMessage += token;
          writeStreamLine(res, { type: "token", token });
        }
      }
    }

    const finalMessage = assistantMessage.trim() || "I could not generate a response right now.";

    await convex.mutation(anyApi.conversations.addMessage, {
      conversationId,
      role: "assistant",
      content: finalMessage,
      createdAt: Date.now()
    });

    writeStreamLine(res, {
      type: "done",
      message: finalMessage,
      conversationId: String(conversationId)
    });

    res.end();
  } catch (error) {
    console.error("Error handling /chat request", error);

    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    writeStreamLine(res, { type: "error", error: "Internal server error" });
    res.end();
  }
});

app.listen(env.PORT, () => {
  console.log(`Backend listening on http://localhost:${env.PORT}`);
});
