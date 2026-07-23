/**
 * Helper compartilhado de paginação pra queries Supabase que precisam ler
 * TODAS as linhas de uma tabela do usuário (não só uma página pra UI).
 *
 * Por quê existe: o PostgREST tem um teto rígido de linhas por página
 * (`db-max-rows`, geralmente 1000) que um `.range()` maior não ultrapassa —
 * uma query sem paginação simplesmente devolve as primeiras N linhas e
 * SILENCIA o resto (sem erro nenhum). Isso já foi corrigido antes em
 * `lib/ir/consultas/ledger.ts` e `lib/indicadores/actions.ts`
 * (`buscarTodasCotacoesDolar`) com o mesmo padrão de loop; a varredura de
 * segurança/qualidade de 2026-07-22 (docs/MAPA-DE-DADOS.md §8.59) achou o
 * mesmo problema em `obterLivroRazao`/`obterLivroProventos`, que ainda não
 * paginavam — este helper existe pra não copiar o loop pela 4a vez.
 *
 * Uso: passe uma função que recebe (inicio, fim) e devolve a query Supabase
 * já com `.range(inicio, fim)` aplicado (e todo o resto: `.select()`,
 * `.eq()`, `.order()` etc. antes do `.range`).
 */
export async function buscarTodasLinhas<T>(
  montarQuery: (
    inicio: number,
    fim: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  tamanhoPagina = 1000
): Promise<T[]> {
  const todas: T[] = [];
  let pagina = 0;

  while (true) {
    const inicio = pagina * tamanhoPagina;
    const fim = inicio + tamanhoPagina - 1;
    const { data, error } = await montarQuery(inicio, fim);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    todas.push(...data);

    if (data.length < tamanhoPagina) break;
    pagina++;
  }

  return todas;
}
