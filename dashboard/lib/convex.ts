import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";

type ConversationSummary = {
  _id: string;
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

function getConvexUrl() {
  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!url) {
    throw new Error("CONVEX_URL or NEXT_PUBLIC_CONVEX_URL is required for dashboard");
  }

  return url;
}

function getClient() {
  return new ConvexHttpClient(getConvexUrl());
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const client = getClient();
  const conversations = await client.query(anyApi.conversations.listConversations, {});

  return conversations as ConversationSummary[];
}

export async function getConversationThread(
  conversationId: string
): Promise<ConversationThread | null> {
  const client = getClient();
  const thread = await client.query(anyApi.conversations.getConversationThread, {
    conversationId
  });

  return thread as ConversationThread | null;
}
