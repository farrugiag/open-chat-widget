import Link from "next/link";
import { listConversations } from "../lib/convex";
import { requireAuth } from "../lib/auth";

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

export default async function DashboardPage() {
  await requireAuth();
  const conversations = await listConversations();

  return (
    <main className="page-wrap">
      <div className="headline">
        <div>
          <h1>Conversations</h1>
          <span className="subtle">{conversations.length} conversation(s)</span>
        </div>
        <form action="/api/logout" method="post">
          <button className="logout-btn" type="submit">
            Log out
          </button>
        </form>
      </div>

      <section className="list">
        {conversations.length === 0 ? (
          <article className="card">
            <div className="card-title">No conversations yet</div>
            <div className="card-last">Messages from the widget will appear here.</div>
          </article>
        ) : (
          conversations.map((conversation) => (
            <Link
              key={conversation._id}
              className="card"
              href={`/conversations/${conversation._id}`}
            >
              <div className="card-title">Session: {conversation.sessionId}</div>
              <div className="card-time">Updated {formatDate(conversation.updatedAt)}</div>
              <div className="card-last">
                {conversation.lastMessage?.trim() || "No messages in this conversation"}
              </div>
            </Link>
          ))
        )}
      </section>
    </main>
  );
}
