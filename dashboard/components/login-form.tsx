"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "Invalid password");
      }

      router.replace("/");
      router.refresh();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Login failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={onSubmit}>
      <h1>Admin Login</h1>
      <p>Use the static dashboard password configured in your environment.</p>
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Enter password"
        required
      />
      <button type="submit" disabled={loading}>
        {loading ? "Checking..." : "Log in"}
      </button>
      {error ? <span className="error">{error}</span> : null}
    </form>
  );
}
