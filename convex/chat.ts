import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

type ChatArgs = {
  sessionId: string;
  message: string;
  model?: string;
};

type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatResult = {
  conversationId: Id<"conversations">;
  message: string;
};

export const chat: unknown = action({
  args: {
    sessionId: v.string(),
    message: v.string(),
    model: v.optional(v.string())
  },
  handler: async (ctx, args: ChatArgs): Promise<ChatResult> => {
    const openAiApiKey = process.env.OPENAI_API_KEY;

    if (!openAiApiKey) {
      throw new Error("OPENAI_API_KEY is not configured for Convex actions");
    }

    const now = Date.now();
    const conversationId = (await ctx.runMutation(api.conversations.getOrCreateConversation, {
      sessionId: args.sessionId,
      now
    })) as Id<"conversations">;

    await ctx.runMutation(api.conversations.addMessage, {
      conversationId,
      role: "user",
      content: args.message,
      createdAt: now
    });

    const history = (await ctx.runQuery(api.conversations.getHistoryForModel, {
      conversationId,
      limit: 30
    })) as ChatHistoryMessage[];

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: args.model ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a concise and helpful AI assistant embedded in a website chat widget."
          },
          ...history.map((message: ChatHistoryMessage) => ({
            role: message.role,
            content: message.content
          }))
        ]
      })
    });

    if (!openAiResponse.ok) {
      const details = await openAiResponse.text();
      throw new Error(`OpenAI request failed (${openAiResponse.status}): ${details}`);
    }

    const completion = (await openAiResponse.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const assistantMessage = completion.choices?.[0]?.message?.content?.trim();
    const content = assistantMessage || "I could not generate a response right now.";

    await ctx.runMutation(api.conversations.addMessage, {
      conversationId,
      role: "assistant",
      content,
      createdAt: Date.now()
    });

    return {
      conversationId,
      message: content
    };
  }
});
