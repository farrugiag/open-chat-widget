import { redirect } from "next/navigation";
import { LoginForm } from "../../components/login-form";
import { isAuthenticated } from "../../lib/auth";

export default async function LoginPage() {
  if (await isAuthenticated()) {
    redirect("/");
  }

  return (
    <main className="auth-page">
      <LoginForm />
    </main>
  );
}
