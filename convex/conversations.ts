import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const roleValidator = v.union(v.literal("user"), v.literal("assistant"));

export const getConversationBySessionId = query({
  args: {
    sessionId: v.string()
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversations")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .unique();
  }
});

export const getConversationById = query({
  args: {
    conversationId: v.id("conversations")
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
  }
});

export const getOrCreateConversation = mutation({
  args: {
    sessionId: v.string(),
    now: v.number()
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("conversations", {
      sessionId: args.sessionId,
      createdAt: args.now,
      updatedAt: args.now,
      lastMessage: ""
    });
  }
});

export const addMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    role: roleValidator,
    content: v.string(),
    createdAt: v.number()
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      createdAt: args.createdAt
    });

    await ctx.db.patch(args.conversationId, {
      updatedAt: args.createdAt,
      lastMessage: args.content.slice(0, 500)
    });

    return messageId;
  }
});

export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_updated_at")
      .order("desc")
      .collect();

    return conversations.map((conversation) => ({
      _id: conversation._id,
      _creationTime: conversation._creationTime,
      sessionId: conversation.sessionId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastMessage: conversation.lastMessage ?? ""
    }));
  }
});

export const listMessages = query({
  args: {
    conversationId: v.id("conversations")
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation_id_created_at", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .collect();
  }
});

export const getConversationThread = query({
  args: {
    conversationId: v.id("conversations")
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation) {
      return null;
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_id_created_at", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .collect();

    return {
      conversation,
      messages
    };
  }
});

export const getHistoryForModel = query({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_id_created_at", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .collect();

    const normalized = messages.map((message) => ({
      role: message.role,
      content: message.content
    }));

    if (!args.limit || args.limit <= 0 || normalized.length <= args.limit) {
      return normalized;
    }

    return normalized.slice(normalized.length - args.limit);
  }
});
