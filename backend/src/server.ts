import { existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import cors, { type CorsOptions } from "cors";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { env } from "./env.js";

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type ConversationSummary = {
  _id: string;
  _creationTime: number;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  lastMessage: string;
};

type ConversationMessage = {
  _id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type ConversationThread = {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
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

const chatRequestSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  message: z.string().min(1).max(4000)
});

const listConversationsSchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100)
});

const conversationIdParamsSchema = z.object({
  conversationId: z.string().min(1).max(128)
});

function writeStreamLine(res: Response, payload: ChatStreamPayload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

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

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getChatApiKey(req: Request): string | null {
  return req.header("x-api-key") ?? req.header("x-widget-api-key") ?? null;
}

function requireChatApiKey(req: Request, res: Response): boolean {
  const apiKey = getChatApiKey(req);

  if (!apiKey || !secureEquals(env.WIDGET_API_KEY, apiKey)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

function requireAdminApiKey(req: Request, res: Response): boolean {
  if (!env.ADMIN_API_KEY) {
    res.status(503).json({ error: "ADMIN_API_KEY is not configured on this deployment" });
    return false;
  }

  const apiKey = req.header("x-admin-api-key") ?? "";

  if (!secureEquals(env.ADMIN_API_KEY, apiKey)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

function parseChatRequest(req: Request, res: Response): { sessionId: string; message: string } | null {
  const parsed = chatRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    if (env.NODE_ENV === "development") {
      res.status(400).json({ error: "Invalid request payload", details: parsed.error.flatten() });
      return null;
    }

    res.status(400).json({ error: "Invalid request payload" });
    return null;
  }

  return parsed.data;
}

async function prepareConversationData(sessionId: string, message: string): Promise<{
  conversationId: string;
  conversationIdRaw: unknown;
  history: HistoryMessage[];
}> {
  const now = Date.now();

  const conversationIdRaw = await convex.mutation(anyApi.conversations.getOrCreateConversation, {
    sessionId,
    now
  });

  await convex.mutation(anyApi.conversations.addMessage, {
    conversationId: conversationIdRaw,
    role: "user",
    content: message,
    createdAt: now
  });

  const history = (await convex.query(anyApi.conversations.getHistoryForModel, {
    conversationId: conversationIdRaw,
    limit: env.MAX_HISTORY_MESSAGES
  })) as HistoryMessage[];

  return {
    conversationId: String(conversationIdRaw),
    conversationIdRaw,
    history
  };
}

async function generateAssistantMessage(
  history: HistoryMessage[],
  onToken?: (token: string) => void
): Promise<string> {
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
          content: "You are a concise and helpful AI assistant embedded in a support chat widget."
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

  const processEvent = (rawEvent: string) => {
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
      onToken?.(token);
    }
  };

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
      processEvent(rawEvent);
    }
  }

  if (buffer.trim()) {
    processEvent(buffer);
  }

  return assistantMessage.trim() || "I could not generate a response right now.";
}

async function persistAssistantMessage(conversationIdRaw: unknown, message: string): Promise<void> {
  await convex.mutation(anyApi.conversations.addMessage, {
    conversationId: conversationIdRaw,
    role: "assistant",
    content: message,
    createdAt: Date.now()
  });
}

async function runChatCompletion(sessionId: string, message: string): Promise<{
  conversationId: string;
  finalMessage: string;
}> {
  const { conversationId, conversationIdRaw, history } = await prepareConversationData(sessionId, message);

  const finalMessage = await generateAssistantMessage(history);
  await persistAssistantMessage(conversationIdRaw, finalMessage);

  return { conversationId, finalMessage };
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
    allowedHeaders: ["Content-Type", "x-api-key", "x-widget-api-key", "x-admin-api-key"]
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

app.get("/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
});

app.get("/v1/openapi.json", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;

  res.status(200).json({
    openapi: "3.1.0",
    info: {
      title: "Open Chat Widget API",
      version: "1.0.0",
      description: "Headless chat and conversation APIs for custom frontends."
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "Service is healthy"
            }
          }
        }
      },
      "/v1/chat": {
        post: {
          summary: "Non-streaming chat response",
          security: [{ ApiKeyAuth: [] }],
          responses: {
            "200": {
              description: "Assistant response"
            }
          }
        }
      },
      "/v1/chat/stream": {
        post: {
          summary: "Streaming chat response (NDJSON)",
          security: [{ ApiKeyAuth: [] }],
          responses: {
            "200": {
              description: "NDJSON stream events"
            }
          }
        }
      },
      "/v1/admin/conversations": {
        get: {
          summary: "List conversations",
          security: [{ AdminApiKeyAuth: [] }],
          responses: {
            "200": {
              description: "Conversation list"
            }
          }
        }
      },
      "/v1/admin/conversations/{conversationId}": {
        get: {
          summary: "Get conversation thread",
          security: [{ AdminApiKeyAuth: [] }],
          parameters: [
            {
              name: "conversationId",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "Conversation with messages"
            },
            "404": {
              description: "Conversation not found"
            }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key"
        },
        AdminApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-admin-api-key"
        }
      }
    }
  });
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

app.post("/v1/chat", async (req, res) => {
  if (!isWithinRateLimit(req)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  if (!requireChatApiKey(req, res)) {
    return;
  }

  const parsed = parseChatRequest(req, res);

  if (!parsed) {
    return;
  }

  try {
    const result = await runChatCompletion(parsed.sessionId, parsed.message);

    res.status(200).json({
      conversationId: result.conversationId,
      message: result.finalMessage
    });
  } catch (error) {
    console.error("Error handling /v1/chat request", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function handleStreamingChat(req: Request, res: Response): Promise<void> {
  if (!isWithinRateLimit(req)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  if (!requireChatApiKey(req, res)) {
    return;
  }

  const parsed = parseChatRequest(req, res);

  if (!parsed) {
    return;
  }

  try {
    const { conversationId, conversationIdRaw, history } = await prepareConversationData(
      parsed.sessionId,
      parsed.message
    );

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    writeStreamLine(res, { type: "start", conversationId });

    const finalMessage = await generateAssistantMessage(history, (token) => {
      if (!res.writableEnded) {
        writeStreamLine(res, { type: "token", token });
      }
    });

    await persistAssistantMessage(conversationIdRaw, finalMessage);

    if (!res.writableEnded) {
      writeStreamLine(res, { type: "done", message: finalMessage, conversationId });
      res.end();
    }
  } catch (error) {
    console.error("Error handling streaming chat request", error);

    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    if (!res.writableEnded) {
      writeStreamLine(res, { type: "error", error: "Internal server error" });
      res.end();
    }
  }
}

app.post("/v1/chat/stream", async (req, res) => {
  await handleStreamingChat(req, res);
});

app.post("/chat", async (req, res) => {
  await handleStreamingChat(req, res);
});

app.get("/v1/admin/conversations", async (req, res) => {
  if (!requireAdminApiKey(req, res)) {
    return;
  }

  const parsed = listConversationsSchema.safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  try {
    const allConversations = (await convex.query(anyApi.conversations.listConversations, {})) as
      | ConversationSummary[]
      | null;

    const conversations = (allConversations ?? []).slice(0, parsed.data.limit);

    res.status(200).json({
      conversations,
      total: allConversations?.length ?? 0
    });
  } catch (error) {
    console.error("Error handling /v1/admin/conversations request", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/v1/admin/conversations/:conversationId", async (req, res) => {
  if (!requireAdminApiKey(req, res)) {
    return;
  }

  const parsedParams = conversationIdParamsSchema.safeParse(req.params);

  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid conversationId" });
    return;
  }

  try {
    const thread = (await convex.query(anyApi.conversations.getConversationThread, {
      conversationId: parsedParams.data.conversationId
    })) as ConversationThread | null;

    if (!thread) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    res.status(200).json(thread);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("invalid")) {
      res.status(400).json({ error: "Invalid conversationId" });
      return;
    }
    console.error("Error handling /v1/admin/conversations/:conversationId request", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(env.PORT, () => {
  console.log(`Backend listening on http://localhost:${env.PORT}`);
});
