import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import cors from "cors";
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

const app = express();
const convex = new ConvexHttpClient(env.CONVEX_URL);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, "..");
const widgetBundlePath = path.isAbsolute(env.WIDGET_BUNDLE_PATH)
  ? env.WIDGET_BUNDLE_PATH
  : path.resolve(backendDir, env.WIDGET_BUNDLE_PATH);

const allowedOrigins = env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((origin) => origin.trim());

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-widget-api-key"]
  })
);
app.use(express.json({ limit: "2mb" }));

const chatRequestSchema = z.object({
  sessionId: z.string().min(1).max(128),
  message: z.string().min(1).max(4000)
});

function writeStreamLine(res: Response, payload: ChatStreamPayload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/widget/chat-widget.js", (_req, res) => {
  if (!existsSync(widgetBundlePath)) {
    res.status(404).json({
      error: "Widget bundle not found. Build the widget with `npm run build --workspace widget`."
    });
    return;
  }

  res.sendFile(widgetBundlePath);
});

app.post("/chat", async (req: Request, res: Response) => {
  const apiKey = req.header("x-widget-api-key");

  if (!apiKey || apiKey !== env.WIDGET_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = chatRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request payload", details: parsed.error.flatten() });
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
    res.setHeader("Cache-Control", "no-cache, no-transform");
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
