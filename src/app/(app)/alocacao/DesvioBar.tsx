const ESCALA_MAX_PP = 20;

export default function DesvioBar({
  label,
  pesoAlvo,
  pesoReal,
  desvio,
  tolerancia,
}: {
  label: string;
  pesoAlvo: number;
  pesoReal: number;
  desvio: number;
  tolerancia: number;
}) {
  const dentroDaFaixa = Math.abs(desvio) <= tolerancia;
  const largura = Math.min(Math.abs(desvio) / ESCALA_MAX_PP, 1) * 50;
  const cor = dentroDaFaixa ? "bg-success" : "bg-danger";
  const corTexto = dentroDaFaixa ? "text-success" : "text-danger";

  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-sm text-muted truncate" title={label}>
        {label}
      </span>
      <div className="flex-1 h-3 bg-surface-2 rounded-sm relative overflow-hidden">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border-strong" />
        <div
          className={`absolute top-0 bottom-0 ${cor} rounded-sm`}
          style={
            desvio >= 0
              ? { left: "50%", width: `${largura}%` }
              : { right: "50%", width: `${largura}%` }
          }
        />
      </div>
      <span className={`w-24 shrink-0 text-xs text-right ${corTexto}`}>
        {desvio >= 0 ? "+" : ""}
        {desvio.toFixed(1)}pp
      </span>
      <span className="w-32 shrink-0 text-xs text-faint text-right">
        alvo {pesoAlvo.toFixed(0)}% · real {pesoReal.toFixed(0)}%
      </span>
    </div>
  );
}
