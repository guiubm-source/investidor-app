/**
 * SEM `"use server"` de propósito — função pura, sem I/O (mesmo espírito de
 * `checklist-estatisticas.ts` e `cambio.ts`), usada só dentro de
 * `lib/ativos/actions.ts`.
 *
 * Centraliza a agregação de proventos por `valor_por_cota` numa janela de
 * dias — antes desta extração (ver docs/MAPA-DE-DADOS.md §8.65/§8.66),
 * `obterChecklistAtivo` tinha essa mesma conta ("hoje menos 365 dias",
 * filtrar, somar") duplicada nos ramos de Ações e FIIs, cada um com sua
 * própria cópia de `new Date()`/`setDate()`. Desde a migração do Dividend
 * Yield de FII pra `valor_por_cota` (mesmo critério de Ações), os dois ramos
 * fazem exatamente a mesma conta — então passaram a chamar esta função
 * única, usada tanto pro Dividend Yield/Preço Justo de Bazin quanto pro
 * aviso de provento atípico (os dois precisam da mesma janela de pontos).
 */
export function agregarProventosPorCotaNaJanela(
  proventos: { data: string; valor_por_cota: number | null }[],
  janelaDias: number,
  hoje: Date = new Date()
): { total: number | null; pontos: { data: string; valor: number }[] } {
  const hojeStr = hoje.toISOString().slice(0, 10);
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - janelaDias);
  const cutoff = inicio.toISOString().slice(0, 10);

  // Nunca conta provento provisionado (`data > hojeStr`) — mesma regra já
  // documentada em §8.23 pro DY de FII original, agora válida pros dois
  // grupos.
  const pontos = proventos
    .filter(
      (p): p is typeof p & { valor_por_cota: number } =>
        p.valor_por_cota !== null && p.data >= cutoff && p.data <= hojeStr
    )
    .map((p) => ({ data: p.data, valor: Number(p.valor_por_cota) }));

  // `null` (não 0) quando não há nenhum ponto elegível — distingue "sem
  // dado disponível" (lançamentos antigos sem valor_por_cota) de "pagou
  // zero no período", mesma convenção de "—" do resto do checklist.
  const total = pontos.length > 0 ? pontos.reduce((s, p) => s + p.valor, 0) : null;
  return { total, pontos };
}
