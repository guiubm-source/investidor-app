"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { loginComEmailSenha, loginComGoogle, type LoginState } from "./actions";
import { useToast } from "@/components/ToastProvider";

const estadoInicial: LoginState = {};

const RECURSOS = [
  "Perfil de suitability alinhado às normas CVM/B3",
  "Alocação por classes com desvio em tempo real",
  "Carteira consolidada com preços via TradingView",
];

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(
    loginComEmailSenha,
    estadoInicial
  );
  const toast = useToast();

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state.error, toast]);

  return (
    <div className="min-h-screen flex">
      {/* Painel de marca — visível a partir de lg */}
      <div className="hidden lg:flex relative w-1/2 overflow-hidden bg-[radial-gradient(120%_100%_at_0%_0%,#17352a_0%,#0e1512_55%)]">
        <ChartArt />

        <div className="relative z-10 flex flex-col justify-between w-full p-12 xl:p-16">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
              <span className="text-accent font-semibold text-sm">Ai</span>
            </div>
            <span className="text-ink font-medium">App do Investidor</span>
          </div>

          <div className="max-w-md">
            <h1 className="text-4xl xl:text-[2.75rem] leading-[1.15] font-medium text-ink mb-4">
              Invista com clareza,{" "}
              <span className="text-accent">decisão por decisão.</span>
            </h1>
            <p className="text-muted text-[15px] leading-relaxed">
              Organize seu perfil, sua alocação e sua carteira em um só lugar
              — com dados atualizados e uma visão honesta do seu desvio em
              relação ao plano.
            </p>
          </div>

          <ul className="space-y-3">
            {RECURSOS.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-muted">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent shrink-0 mt-0.5"
                  aria-hidden="true"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Formulário */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="h-8 w-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
              <span className="text-accent font-semibold text-sm">Ai</span>
            </div>
            <span className="text-ink font-medium">App do Investidor</span>
          </div>

          <h1 className="text-2xl font-medium text-ink mb-1">Entrar</h1>
          <p className="text-sm text-muted mb-7">
            Acesse sua conta de investidor.
          </p>

          <form action={loginComGoogle}>
            <button
              type="submit"
              className="btn btn-secondary w-full flex items-center justify-center gap-2"
            >
              <GoogleIcon />
              Continuar com Google
            </button>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-faint">ou entre com email</span>
            <div className="h-px flex-1 bg-border" />
          </div>

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

            <button type="submit" disabled={pending} className="btn btn-primary w-full">
              {pending ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <p className="text-sm text-muted text-center mt-7">
            Ainda não tem conta?{" "}
            <Link href="/cadastro" className="text-ink font-medium hover:underline">
              Cadastre-se
            </Link>
          </p>
        </div>
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

function ChartArt() {
  return (
    <svg
      className="absolute inset-0 h-full w-full opacity-[0.35]"
      viewBox="0 0 600 800"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <path
        d="M0 620L60 600 120 640 180 560 240 590 300 500 360 540 420 440 480 470 540 380 600 410"
        stroke="#2aa76d"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M0 700L60 690 120 710 180 660 240 675 300 630 360 650 420 600 480 615 540 570 600 585"
        stroke="#1f8f5c"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      <g stroke="#2e3b34" strokeWidth="1">
        <line x1="0" y1="150" x2="600" y2="150" />
        <line x1="0" y1="300" x2="600" y2="300" />
        <line x1="0" y1="450" x2="600" y2="450" />
      </g>
      <circle cx="540" cy="410" r="4" fill="#3fcb82" />
      <circle cx="300" cy="500" r="4" fill="#3fcb82" opacity="0.7" />
    </svg>
  );
}
