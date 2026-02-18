import { NextResponse } from "next/server";
import { clearAuthCookie } from "../../../lib/auth";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  clearAuthCookie(response);
  return response;
}
