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
    // Escala 1920x1080 (§8.63, 2026-07-29): alargado pra max-w-[1600px] pra
    // bater com o container das páginas reais — senão o esqueleto de
    // carregamento pisca mais estreito que o conteúdo que vem em seguida.
    <div className="px-10 py-10">
      <div className="max-w-[1600px] mx-auto space-y-5">
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
