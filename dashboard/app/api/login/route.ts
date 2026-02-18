import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { attachAuthCookie, getDashboardPassword } from "../../../lib/auth";

const loginSchema = z.object({
  password: z.string().min(1)
});

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 10;

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip") || "unknown";
}

function isRateLimited(request: Request): boolean {
  const ip = getClientIp(request);
  const now = Date.now();
  const state = loginAttempts.get(ip);

  if (!state || now > state.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }

  state.count += 1;
  return state.count > LOGIN_MAX_ATTEMPTS;
}

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export async function POST(request: Request) {
  try {
    if (isRateLimited(request)) {
      return NextResponse.json({ error: "Too many login attempts" }, { status: 429 });
    }

    const json = await request.json();
    const parsed = loginSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    const isValid = secureEquals(parsed.data.password, getDashboardPassword());

    if (!isValid) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    attachAuthCookie(response);
    return response;
  } catch (error) {
    console.error("Login route failed", error);
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
