"use client";

import { useActionState } from "react";
import Link from "next/link";
import { enviarEmailRecuperacao, type EsqueciSenhaState } from "./actions";

const estadoInicial: EsqueciSenhaState = {};

export default function EsqueciSenhaPage() {
  const [state, formAction, pending] = useActionState(
    enviarEmailRecuperacao,
    estadoInicial
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm card p-8">
        <h1 className="text-2xl font-medium text-ink mb-1">
          Recuperar senha
        </h1>
        <p className="text-sm text-muted mb-6">
          Informe seu email e enviaremos um link para redefinir sua senha.
        </p>

        {state.sucesso ? (
          <p className="success-box">
            Se existir uma conta com esse email, enviamos um link de redefinição.
            Verifique sua caixa de entrada (e o spam).
          </p>
        ) : (
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

            {state.error && <p className="error-box">{state.error}</p>}

            <button type="submit" disabled={pending} className="btn btn-primary w-full">
              {pending ? "Enviando..." : "Enviar link de redefinição"}
            </button>
          </form>
        )}

        <p className="text-sm text-muted text-center mt-6">
          <Link href="/login" className="text-ink font-medium hover:underline">
            Voltar para o login
          </Link>
        </p>
      </div>
    </div>
  );
}
