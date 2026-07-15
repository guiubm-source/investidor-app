"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

/**
 * Sistema de toast/snackbar — única forma de feedback de AÇÃO (sucesso ou
 * erro) no app, ver docs/MAPA-DE-DADOS.md, decisão UX/UI 2026-07-14.
 *
 * Escopo deliberado (decisão do Guilherme): substitui os antigos
 * error-box/success-box "de ação" (ex. "não foi possível salvar", "login
 * inválido", confirmações de exclusão/atualização bem-sucedida). NÃO
 * substitui erro de campo individual em formulário (a classe `field-error`
 * continua colada no input errado) — um toast não aponta qual campo está
 * errado e some sozinho antes do usuário conseguir corrigir com calma.
 *
 * Montado uma única vez no layout raiz (`src/app/layout.tsx`), então
 * `useToast()` funciona em qualquer página/componente client do app,
 * inclusive fora do grupo de rotas autenticadas (login, cadastro, etc.).
 */

type ToastType = "success" | "error";
type ToastItem = { id: number; type: ToastType; message: string };

type ToastContextValue = {
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DURACAO_MS: Record<ToastType, number> = { success: 4000, error: 6000 };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const proximoId = useRef(0);

  const remover = useCallback((id: number) => {
    setToasts((atual) => atual.filter((t) => t.id !== id));
  }, []);

  const adicionar = useCallback(
    (type: ToastType, message: string) => {
      const id = proximoId.current++;
      setToasts((atual) => [...atual, { id, type, message }]);
      window.setTimeout(() => remover(id), DURACAO_MS[type]);
    },
    [remover]
  );

  const value: ToastContextValue = {
    success: (message) => adicionar("success", message),
    error: (message) => adicionar("error", message),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start justify-between gap-3 ${
              t.type === "success" ? "success-box" : "error-box"
            }`}
          >
            <span>{t.message}</span>
            <button
              type="button"
              onClick={() => remover(t.id)}
              aria-label="Fechar aviso"
              className="opacity-70 hover:opacity-100 leading-none"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast precisa ser usado dentro de <ToastProvider>.");
  return ctx;
}
