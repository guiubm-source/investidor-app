"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginComEmailSenha, loginComGoogle, type LoginState } from "./actions";

const estadoInicial: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(
    loginComEmailSenha,
    estadoInicial
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm card p-8">
        <h1 className="text-2xl font-medium text-ink mb-1">Entrar</h1>
        <p className="text-sm text-muted mb-6">
          Acesse sua conta de investidor.
        </p>

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="input"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="password" className="label mb-0">
                Senha
              </label>
              <Link href="/esqueci-senha" className="text-xs text-faint hover:text-muted">
                Esqueci minha senha
              </Link>
            </div>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="input"
            />
          </div>

          {state.error && <p className="error-box">{state.error}</p>}

          <button type="submit" disabled={pending} className="btn btn-primary w-full">
            {pending ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <div className="flex items-center gap-3 my-5">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-faint">ou</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form action={loginComGoogle}>
          <button type="submit" className="btn btn-secondary w-full flex items-center justify-center gap-2">
            <GoogleIcon />
            Continuar com Google
          </button>
        </form>

        <p className="text-sm text-muted text-center mt-6">
          Ainda não tem conta?{" "}
          <Link href="/cadastro" className="text-ink font-medium hover:underline">
            Cadastre-se
          </Link>
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4c-7.5 0-14 4.2-17.7 10.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.4-1.9 14.1-5.1l-6.5-5.5c-2 1.5-4.7 2.6-7.6 2.6-5.3 0-9.7-3.1-11.3-7.6l-6.6 5.1C9.9 39.6 16.4 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.5 5.5C41.6 36 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}
