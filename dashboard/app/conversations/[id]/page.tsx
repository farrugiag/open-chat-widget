import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth } from "../../../lib/auth";
import { getConversationThread } from "../../../lib/convex";

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

type ConversationPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ConversationPage({ params }: ConversationPageProps) {
  await requireAuth();
  const { id } = await params;

  const thread = await getConversationThread(id);

  if (!thread) {
    notFound();
  }

  return (
    <main className="page-wrap">
      <div className="headline">
        <div>
          <Link className="back-link" href="/">
            ← Back to conversations
          </Link>
          <h1>Session {thread.conversation.sessionId}</h1>
          <span className="subtle">Updated {formatDate(thread.conversation.updatedAt)}</span>
        </div>
        <form action="/api/logout" method="post">
          <button className="logout-btn" type="submit">
            Log out
          </button>
        </form>
      </div>

      <section className="thread">
        {thread.messages.map((message) => (
          <article
            key={message._id}
            className={`thread-message ${message.role === "user" ? "user" : "assistant"}`}
          >
            <div className="thread-meta">
              {message.role === "user" ? "User" : "Assistant"} • {formatDate(message.createdAt)}
            </div>
            <div>{message.content}</div>
          </article>
        ))}
      </section>
    </main>
  );
}
