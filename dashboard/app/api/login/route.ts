import { NextResponse } from "next/server";
import { z } from "zod";
import { attachAuthCookie, getDashboardPassword } from "../../../lib/auth";

const loginSchema = z.object({
  password: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const parsed = loginSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    const isValid = parsed.data.password === getDashboardPassword();

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
