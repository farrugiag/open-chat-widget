import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextResponse } from "next/server";

export const AUTH_COOKIE_NAME = "os_chatbot_dashboard_auth";
const AUTH_COOKIE_VALUE = "1";

export function getDashboardPassword(): string {
  const password = process.env.DASHBOARD_PASSWORD;

  if (!password) {
    throw new Error("DASHBOARD_PASSWORD is not configured");
  }

  return password;
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE_NAME)?.value === AUTH_COOKIE_VALUE;
}

export async function requireAuth(): Promise<void> {
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    redirect("/login");
  }
}

export function attachAuthCookie(response: NextResponse): void {
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: AUTH_COOKIE_VALUE,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });
}

export function clearAuthCookie(response: NextResponse): void {
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}
