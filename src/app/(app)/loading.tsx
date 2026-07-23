/**
 * Loading UI do grupo (app) — ver docs/MAPA-DE-DADOS.md §8.59 (2026-07-22).
 * Next.js envolve automaticamente o `page.tsx` de cada rota autenticada numa
 * `<Suspense>` cujo fallback é este componente, mostrado enquanto os Server
 * Components da página buscam dados (ex.: `obterPosicaoConsolidada`,
 * `obterEstruturaAlocacao`) antes da primeira renderização. Sem este
 * arquivo, a navegação entre abas ficava com a tela anterior "congelada" até
 * os dados novos chegarem, sem nenhum indício de carregamento — mesmo nível
 * de `layout.tsx`, então a Sidebar continua visível e só o conteúdo de
 * `<main>` mostra este estado.
 */
export default function AppLoading() {
  return (
    <div className="px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="card p-8 animate-pulse">
          <div className="h-6 w-48 rounded bg-surface-2 mb-3" />
          <div className="h-4 w-72 rounded bg-surface-2" />
        </div>
        <div className="card p-8 animate-pulse space-y-3">
          <div className="h-4 w-full rounded bg-surface-2" />
          <div className="h-4 w-5/6 rounded bg-surface-2" />
          <div className="h-4 w-4/6 rounded bg-surface-2" />
        </div>
      </div>
    </div>
  );
}
