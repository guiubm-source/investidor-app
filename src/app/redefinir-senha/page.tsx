"use client";

import { useActionState, useEffect } from "react";
import { redefinirSenha, type RedefinirSenhaState } from "./actions";
import { useToast } from "@/components/ToastProvider";

const estadoInicial: RedefinirSenhaState = {};

export default function RedefinirSenhaPage() {
  const [state, formAction, pending] = useActionState(redefinirSenha, estadoInicial);
  const toast = useToast();

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state.error, toast]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm card p-8">
        <h1 className="text-2xl font-medium text-ink mb-1">
          Definir nova senha
        </h1>
        <p className="text-sm text-muted mb-6">
          Escolha uma nova senha para sua conta.
        </p>

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="password" className="label">
              Nova senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="input"
            />
          </div>

          <div>
            <label htmlFor="confirmarPassword" className="label">
              Confirmar nova senha
            </label>
            <input
              id="confirmarPassword"
              name="confirmarPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="input"
            />
          </div>

          <button type="submit" disabled={pending} className="btn btn-primary w-full">
            {pending ? "Salvando..." : "Salvar nova senha"}
          </button>
        </form>
      </div>
    </div>
  );
}
