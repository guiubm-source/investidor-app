"use client";

import { useEffect } from "react";

/**
 * Modal de confirmação de exclusão — padrão único usado em todo o app (ver
 * docs/MAPA-DE-DADOS.md, decisão UX/UI 2026-07-14). Substitui o antigo
 * padrão de banner inline que existia em Setor/Classe/Ativo, e passa a
 * cobrir também os fluxos que antes excluíam direto sem perguntar nada
 * (transações, resultados trimestrais, corretoras, lançamentos da
 * Carteira, etc.).
 *
 * Uso: cada tela mantém seu próprio estado local (ex. `const [alvo,
 * setAlvo] = useState<string | null>(null)`) pra saber QUAL item está
 * prestes a ser excluído, e renderiza `<ConfirmModal onConfirm={...}
 * onCancel={() => setAlvo(null)} />` condicionalmente quando `alvo !==
 * null`. O componente não guarda estado nenhum sobre "qual" — só cuida da
 * UI de confirmação e do loading enquanto a exclusão está em andamento.
 */
export default function ConfirmModal({
  title,
  message,
  confirmLabel = "Excluir",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
  loading = false,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, loading]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => !loading && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="card w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="confirm-modal-title" className="text-sm font-medium text-ink mb-1">
          {title}
        </p>
        <p className="text-xs text-muted mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? "Excluindo…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
