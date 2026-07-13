"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITENS = [
  { href: "/dashboard", label: "Painel", icone: "home" },
  { href: "/ativos", label: "Ativos", icone: "layers" },
  { href: "/carteira", label: "Carteira", icone: "wallet" },
  { href: "/alocacao", label: "Alocação", icone: "chart-pie" },
  { href: "/configuracoes", label: "Configurações", icone: "settings" },
] as const;

export default function Sidebar() {
  const [expandido, setExpandido] = useState(false);
  const pathname = usePathname();

  return (
    <aside
      className={`shrink-0 border-r border-border bg-surface flex flex-col transition-all duration-150 ${
        expandido ? "w-56" : "w-14"
      }`}
    >
      <div className="flex items-center h-14 px-3 border-b border-border">
        <button
          onClick={() => setExpandido((v) => !v)}
          aria-label={expandido ? "Recolher menu" : "Expandir menu"}
          className="text-faint hover:text-ink shrink-0"
        >
          <Icone nome="menu-2" />
        </button>
        {expandido && (
          <span className="ml-3 text-sm font-medium text-ink truncate">
            App do Investidor
          </span>
        )}
      </div>

      <nav className="flex-1 py-2 px-2 space-y-1">
        {ITENS.map((item) => {
          const ativo = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
                ativo ? "bg-surface-2 text-ink" : "text-muted hover:text-ink hover:bg-surface-2"
              }`}
            >
              <Icone nome={item.icone} />
              {expandido && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-2 border-t border-border">
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            title="Sair"
            className="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted hover:text-ink hover:bg-surface-2 w-full"
          >
            <Icone nome="logout" />
            {expandido && <span>Sair</span>}
          </button>
        </form>
      </div>
    </aside>
  );
}

function Icone({ nome }: { nome: string }) {
  const paths: Record<string, string> = {
    "menu-2": "M4 6h16M4 12h16M4 18h16",
    home: "M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1v-9z",
    "chart-pie": "M12 3a9 9 0 100 18 9 9 0 000-18zM12 3v9h9",
    settings:
      "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13.5a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V20a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 112.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H4a2 2 0 110-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H10a1.7 1.7 0 001-1.6V4a2 2 0 114 0v.1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V10a1.7 1.7 0 001.6 1h.1a2 2 0 110 4h-.1a1.7 1.7 0 00-1.6 1z",
    logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
    wallet: "M3 7a2 2 0 012-2h13a1 1 0 011 1v2H5a2 2 0 100 4h14v6a2 2 0 01-2 2H5a2 2 0 01-2-2V7zM16 12h3",
    layers: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d={paths[nome] ?? ""} />
    </svg>
  );
}
