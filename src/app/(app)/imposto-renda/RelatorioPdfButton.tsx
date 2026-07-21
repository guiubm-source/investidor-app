"use client";

/**
 * Botão "Gerar PDF" (fase 11, §8.32.26) — busca o relatório completo já
 * pronto (`obterRelatorioCompletoIR`, `lib/ir/actions.ts`) e monta o PDF
 * inteiramente no navegador via `@react-pdf/renderer` (`pdf(...).toBlob()`).
 * Nada é enviado a nenhum servidor de terceiros — a geração é 100% local.
 */

import { useState } from "react";
import { obterRelatorioCompletoIR } from "@/lib/ir/actions";
import { Documento } from "@/lib/ir/relatorios/gerar-pdf";

export default function RelatorioPdfButton({ ano }: { ano: number }) {
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const gerar = async () => {
    setGerando(true);
    setErro(null);
    try {
      const relatorio = await obterRelatorioCompletoIR(ano);
      const { pdf } = await import("@react-pdf/renderer");
      const blob = await pdf(<Documento relatorio={relatorio} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `relatorio-ir-${relatorio.capa.anoCalendario}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      setErro("Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={gerar} disabled={gerando} className="btn-secondary text-sm px-3 py-1.5">
        {gerando ? "Gerando PDF..." : `Gerar PDF (${ano})`}
      </button>
      {erro && <span className="text-xs text-danger">{erro}</span>}
    </div>
  );
}
