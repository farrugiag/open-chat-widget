import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  conversations: defineTable({
    sessionId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastMessage: v.optional(v.string())
  })
    .index("by_session_id", ["sessionId"])
    .index("by_updated_at", ["updatedAt"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    createdAt: v.number()
  })
    .index("by_conversation_id", ["conversationId"])
    .index("by_conversation_id_created_at", ["conversationId", "createdAt"])
});
