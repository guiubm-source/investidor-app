/**
 * Cálculo de posição por custo médio ponderado — funções PURAS (sem acesso a
 * banco/rede), deliberadamente FORA de qualquer arquivo `"use server"`.
 *
 * Motivo: no Next.js, todo arquivo com `"use server"` no topo trata cada
 * função exportada como Server Action, e Server Actions são obrigadas a ser
 * `async` (o build falha em produção — `next build`/Turbopack — se não
 * forem, mesmo que `tsc`/`eslint` não acusem nada, já que é uma checagem
 * específica do compilador do Next, não do TypeScript). Como
 * `aplicarTransacaoNaPosicao`/`precoMedioDoEstado`/`ordenarTransacoes` são
 * síncronas de propósito (são só matemática, chamadas em loop por
 * lib/ativos/preco-historico.ts pra recalcular posição em CADA ponto de uma
 * série histórica — `async` desnecessário ali só adicionaria overhead de
 * microtask sem benefício nenhum), elas moram aqui, num módulo comum
 * importado tanto por lib/ativos/actions.ts quanto por
 * lib/ativos/preco-historico.ts. Fonte única de verdade continua sendo este
 * arquivo (ver docs/MAPA-DE-DADOS.md §3).
 */

/**
 * Ver docs/MAPA-DE-DADOS.md §8.22: além de compra/venda, `tipo` também cobre
 * eventos societários — desdobramento/grupamento (só `fatorProporcao`, sem
 * quantidade/preço) e bonificação (`quantidade` recebida + `valorCapitalizado`,
 * sem preço). Por isso quantidade/precoUnitario/custos viraram opcionais:
 * cada tipo usa só o subconjunto de campos que faz sentido pra ele — ver
 * `aplicarTransacaoNaPosicao` pra qual campo é obrigatório em qual tipo.
 */
export type TransacaoCalc = {
  tipo: "compra" | "venda" | "desdobramento" | "grupamento" | "bonificacao";
  data: string;
  /**
   * compra/venda: quantidade negociada. bonificação: quantidade de ações
   * recebidas. Ausente/nulo em desdobramento/grupamento. `| null` além de
   * opcional porque quem lê direto do banco (ex. `LancamentoTransacao` em
   * lib/carteira/actions.ts) sempre traz a coluna como `number | null`, nunca
   * `undefined` — aceitar os dois evita conversão manual em cada chamador.
   */
  quantidade?: number | null;
  /** Só compra/venda. */
  precoUnitario?: number | null;
  /** Só compra/venda (default 0 se ausente). */
  custos?: number | null;
  /** Só desdobramento/grupamento: fator multiplicador da quantidade em carteira (2 = desdobra 1:2, 0.1 = agrupa 10:1). */
  fatorProporcao?: number | null;
  /** Só bonificação: valor total (R$) atribuído pela empresa à capitalização — 0 se não houver (bonificação se comporta como split puro). */
  valorCapitalizado?: number | null;
  /**
   * Horário de negociação (campo opcional do formulário, "Detalhes
   * fiscais") — usado só como desempate de ORDEM dentro do mesmo dia em
   * `ordenarTransacoes`, ver comentário lá. Formato livre (o que o usuário
   * digitou), não um `Date` — a comparação é lexicográfica, então só faz
   * sentido se o usuário digitar num formato ordenável (ex. "14:30").
   */
  horarioNegociacao?: string | null;
};

export type EstadoPosicao = {
  quantidade: number;
  custoTotal: number;
  lucroRealizado: number;
  /**
   * Soma bruta de tudo que já foi pago em compras até aqui — SÓ CRESCE (venda
   * nunca reduz este campo, diferente de `custoTotal`, que é o custo médio ×
   * quantidade ainda em carteira). Usado como denominador da rentabilidade
   * histórica "retorno simples acumulado" (ver docs/MAPA-DE-DADOS.md §8.15):
   * (valorPosicao + lucroRealizado) / totalInvestidoBruto − 1. Sem esse
   * acumulador separado não dá pra medir corretamente o retorno de um ativo
   * já parcialmente vendido — `custoTotal` sozinho "esquece" o que já saiu.
   */
  totalInvestidoBruto: number;
  /**
   * Soma bruta (líquida de custos) de tudo que já foi recebido em vendas até
   * aqui — SÓ CRESCE, espelho de `totalInvestidoBruto` mas do lado da venda.
   * Usado pra "Total vendido" da seção Ativos encerrados (Posição, ver
   * docs/MAPA-DE-DADOS.md §8.25): sem esse acumulador não dava pra saber
   * quanto um ativo JÁ ZERADO tinha recebido em vendas ao longo do tempo,
   * só o residual (que é 0 depois de zerar).
   */
  totalVendidoLiquido: number;
};

export const ESTADO_POSICAO_INICIAL: EstadoPosicao = {
  quantidade: 0,
  custoTotal: 0,
  lucroRealizado: 0,
  totalInvestidoBruto: 0,
  totalVendidoLiquido: 0,
};

/**
 * Um passo do cálculo de posição por custo médio ponderado — usado tanto
 * por `calcularPosicao` (fold sobre a lista inteira, "posição final") quanto
 * por quem precisa da posição EM CADA PONTO de uma linha do tempo (ex.
 * rentabilidade histórica dia a dia).
 *
 * Método do custo médio ponderado (padrão no Brasil, inclusive para IR sobre
 * renda variável): na compra, o preço médio é recalculado proporcionalmente;
 * na venda, o preço médio NÃO muda — apenas reduz a quantidade e apura lucro
 * ou prejuízo realizado (preço de venda − preço médio, descontados custos).
 *
 * Eventos societários (ver docs/MAPA-DE-DADOS.md §8.22) NÃO mexem em
 * `lucroRealizado` nem `totalInvestidoBruto` — não há venda nem novo aporte
 * de verdade, só reorganização da mesma posição:
 * - desdobramento/grupamento: `custoTotal` não muda, só a quantidade (×
 *   fator) — o preço médio se ajusta sozinho (custoTotal/quantidade).
 * - bonificação: soma a quantidade recebida E o valor capitalizado ao
 *   custoTotal — redistribui o mesmo custo total (mais o capitalizado) sobre
 *   mais ações, nunca trata as novas como "custo zero" isoladamente.
 */
export function aplicarTransacaoNaPosicao(estado: EstadoPosicao, t: TransacaoCalc): EstadoPosicao {
  if (t.tipo === "compra") {
    const valorComprado = (t.quantidade ?? 0) * (t.precoUnitario ?? 0) + (t.custos ?? 0);
    return {
      quantidade: estado.quantidade + (t.quantidade ?? 0),
      custoTotal: estado.custoTotal + valorComprado,
      lucroRealizado: estado.lucroRealizado,
      totalInvestidoBruto: estado.totalInvestidoBruto + valorComprado,
      totalVendidoLiquido: estado.totalVendidoLiquido,
    };
  }

  if (t.tipo === "venda") {
    const precoMedioAtual = estado.quantidade > 0 ? estado.custoTotal / estado.quantidade : 0;
    // `qtdVenda` protege contra vender mais do que a quantidade em carteira
    // (ex.: sob um filtro de corretora, uma venda registrada num sub-livro
    // que não tem saldo suficiente pra cobri-la — cada corretora é tratada
    // como sub-livro independente, ver lib/carteira/posicao.ts). Correção
    // 2026-07-23: `valorVendido`/`totalVendidoLiquido` usava `t.quantidade`
    // CRU (não limitado) enquanto quantidade/custoTotal/lucroRealizado já
    // usavam `qtdVenda` — nesse cenário de limite o "total vendido líquido"
    // ficava inflado (dinheiro que a transação não recebeu de fato dentro
    // deste sub-livro), distorcendo o retorno acumulado. Os 4 campos agora
    // usam sempre `qtdVenda`.
    const qtdVenda = Math.min(t.quantidade ?? 0, estado.quantidade);
    const valorVendido = qtdVenda * (t.precoUnitario ?? 0) - (t.custos ?? 0);
    return {
      quantidade: estado.quantidade - qtdVenda,
      custoTotal: estado.custoTotal - precoMedioAtual * qtdVenda,
      lucroRealizado: estado.lucroRealizado + ((t.precoUnitario ?? 0) - precoMedioAtual) * qtdVenda - (t.custos ?? 0),
      totalInvestidoBruto: estado.totalInvestidoBruto,
      totalVendidoLiquido: estado.totalVendidoLiquido + valorVendido,
    };
  }

  if (t.tipo === "desdobramento" || t.tipo === "grupamento") {
    const fator = t.fatorProporcao ?? 1;
    return {
      quantidade: estado.quantidade * fator,
      custoTotal: estado.custoTotal,
      lucroRealizado: estado.lucroRealizado,
      totalInvestidoBruto: estado.totalInvestidoBruto,
      totalVendidoLiquido: estado.totalVendidoLiquido,
    };
  }

  // bonificacao
  return {
    quantidade: estado.quantidade + (t.quantidade ?? 0),
    custoTotal: estado.custoTotal + (t.valorCapitalizado ?? 0),
    lucroRealizado: estado.lucroRealizado,
    totalInvestidoBruto: estado.totalInvestidoBruto,
    totalVendidoLiquido: estado.totalVendidoLiquido,
  };
}

export function precoMedioDoEstado(estado: EstadoPosicao): number {
  return estado.quantidade > 0 ? estado.custoTotal / estado.quantidade : 0;
}

/**
 * Valor em caixa de UMA transação — compra = quanto saiu do bolso
 * (`quantidade×preço + custos`), venda = quanto entrou líquido
 * (`quantidade×preço − custos`). Usado tanto no total filtrado do
 * Livro-razão (`LivroRazaoView.tsx`) quanto na Visão mensal
 * (`lib/carteira/visao-mensal.ts`) — fonte única pra não deixar as duas
 * telas divergirem na definição de "valor da transação" (ver §3/§8.18).
 *
 * Eventos societários (desdobramento/grupamento/bonificação, ver §8.22)
 * sempre retornam 0 aqui — não há desembolso nem entrada de caixa de
 * verdade, é só reorganização da posição já existente. Retorno 0 nesta
 * função é o mecanismo que os exclui automaticamente do "comprado/vendido"
 * do Livro-razão e do aporte/retirada da Visão mensal, sem precisar filtrar
 * em cada lugar que chama esta função.
 */
export function valorCaixaTransacao(t: TransacaoCalc): number {
  if (t.tipo !== "compra" && t.tipo !== "venda") return 0;
  const bruto = (t.quantidade ?? 0) * (t.precoUnitario ?? 0);
  return t.tipo === "compra" ? bruto + (t.custos ?? 0) : bruto - (t.custos ?? 0);
}

/** Fold de `aplicarTransacaoNaPosicao` sobre a lista inteira — "posição final". */
export function calcularPosicao(transacoesOrdenadas: TransacaoCalc[]) {
  let estado = ESTADO_POSICAO_INICIAL;
  for (const t of transacoesOrdenadas) estado = aplicarTransacaoNaPosicao(estado, t);
  return {
    quantidade: estado.quantidade,
    precoMedio: precoMedioDoEstado(estado),
    lucroRealizado: estado.lucroRealizado,
    totalInvestidoBruto: estado.totalInvestidoBruto,
    totalVendidoLiquido: estado.totalVendidoLiquido,
  };
}

/**
 * Desempate de ordem dentro do MESMO dia (§8.60, correção 2026-07-23): antes
 * usava só `createdAt` (ordem de digitação/importação no banco), que não tem
 * nenhuma relação com a ordem real dos negócios — um compra+venda do mesmo
 * dia importados fora de ordem cronológica inverte o custo médio daquele
 * dia. O formulário já captura `horario_negociacao` (campo opcional de
 * "Detalhes fiscais") pra este fim exato; agora ele é usado como desempate
 * PRIMÁRIO quando as duas transações do empate o têm preenchido, caindo pra
 * `createdAt` nos demais casos (uma das duas sem horário, ou nenhuma). Mesmo
 * gap existe em `ordenarEventosLedgerFiscal` (lib/ir/ledger/construir-ledger.ts)
 * — deliberadamente NÃO tocado aqui: motor fiscal é mudança separada, de
 * maior risco, fora do escopo desta correção (ver docs/MAPA-DE-DADOS.md §8.60).
 */
export function ordenarTransacoes<T extends { data: string; createdAt: string; horarioNegociacao?: string | null }>(
  itens: T[]
): T[] {
  return [...itens].sort((a, b) => {
    if (a.data !== b.data) return a.data < b.data ? -1 : 1;
    if (a.horarioNegociacao && b.horarioNegociacao) {
      if (a.horarioNegociacao !== b.horarioNegociacao) return a.horarioNegociacao < b.horarioNegociacao ? -1 : 1;
    }
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

/**
 * "Retorno simples acumulado" — fórmula única (ver §8.28, correção
 * 2026-07-20): usa `totalVendidoLiquido` (dinheiro TOTAL já embolsado em
 * vendas — principal + lucro), nunca `lucroRealizado` isolado (só a fatia de
 * lucro), porque isso descartava o principal devolvido em qualquer venda
 * parcial anterior — subestimando (às vezes catastroficamente) o retorno de
 * ativos com esse histórico.
 *
 * Extraída em 2026-07-22 (docs/MAPA-DE-DADOS.md §8.59): a mesma fórmula
 * estava copiada em 6 lugares (posicao.ts x3, ativos/actions.ts,
 * preco-historico.ts x2) — cópia-e-cola, não uma função compartilhada.
 * Qualquer correção futura que só tocasse alguns dos 6 regrediria os outros
 * em silêncio (foi assim que o bug do §8.28 nasceu). Devolve
 * `{ valor, pct }`, ambos `null` quando não há base de investimento
 * (`totalInvestidoBruto <= 0`) — cabe ao chamador decidir se prefere `0` em
 * vez de `null` nesse caso (alguns agregados de grupo/carteira preferiam
 * `0`; ver comentário nos pontos de chamada).
 *
 * Correção 2026-07-23 (§8.60): esta fórmula (soma bruta, sem olhar QUANDO o
 * dinheiro entrou/saiu) distorce sob reinvestimento — vender e recomprar o
 * mesmo ativo pelo mesmo preço infla/deflaciona o `pct` mesmo com o mesmo
 * lucro em R$ (exemplo no changelog do mapa). O `valor` (R$) continua
 * correto e usado como está — só é aritmética de caixa (o que entrou, o que
 * saiu). O `pct` foi SUBSTITUÍDO por `calcularXIRR` (abaixo) nos 4 pontos de
 * `lib/carteira/posicao.ts` e no de `lib/ativos/actions.ts` (mesmo stat
 * "Variação total", fonte única). `preco-historico.ts` (série dia a dia do
 * Dashboard) continua usando esta função como estava — é uma série temporal,
 * não um stat pontual, e recalcular XIRR em CADA dia de uma série histórica é
 * uma mudança de escopo maior (performance + semântica do gráfico), fora do
 * pedido desta rodada (revisão da aba Carteira). Esta função continua
 * existindo e exportada por causa desse uso remanescente.
 */
export function calcularRetornoSimplesAcumulado(
  valorAtual: number,
  totalVendidoLiquido: number,
  totalInvestidoBruto: number
): { valor: number | null; pct: number | null } {
  if (totalInvestidoBruto <= 0) return { valor: null, pct: null };
  return {
    valor: valorAtual + totalVendidoLiquido - totalInvestidoBruto,
    pct: ((valorAtual + totalVendidoLiquido) / totalInvestidoBruto - 1) * 100,
  };
}

/** Um fluxo de caixa datado — insumo de `calcularXIRR`. */
export type FluxoCaixaXIRR = {
  /** Data ISO (yyyy-mm-dd). */
  data: string;
  /**
   * Valor assinado: negativo = saída de caixa (compra), positivo = entrada
   * (venda) ou o valor de mercado ATUAL da posição, tratado como uma "venda
   * hipotética hoje" — convenção padrão de XIRR (mesma do Excel/Sheets).
   */
  valor: number;
};

const XIRR_MAX_ITERACOES_NEWTON = 100;
const XIRR_TOLERANCIA = 1e-7;
const XIRR_MAX_ITERACOES_BISSECAO = 200;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

function anosEntre(dataBase: string, data: string): number {
  return (new Date(data).getTime() - new Date(dataBase).getTime()) / MS_POR_DIA / 365;
}

function valorPresenteLiquidoXIRR(fluxos: FluxoCaixaXIRR[], taxa: number, dataBase: string): number {
  return fluxos.reduce((soma, f) => soma + f.valor / Math.pow(1 + taxa, anosEntre(dataBase, f.data)), 0);
}

function derivadaValorPresenteLiquidoXIRR(fluxos: FluxoCaixaXIRR[], taxa: number, dataBase: string): number {
  return fluxos.reduce((soma, f) => {
    const anos = anosEntre(dataBase, f.data);
    if (anos === 0) return soma;
    return soma - (anos * f.valor) / Math.pow(1 + taxa, anos + 1);
  }, 0);
}

/**
 * XIRR (retorno anualizado ponderado pelo dinheiro — MWR) — mesma taxa que o
 * XIRR do Excel/Google Sheets: a taxa anual que zera o valor presente líquido
 * de uma série de fluxos de caixa datados. Substitui o `pct` de
 * `calcularRetornoSimplesAcumulado` (ver comentário acima e §8.60) — decisão
 * do Guilherme 2026-07-23: preferiu XIRR a TWR (Time-Weighted Return) por
 * reaproveitar os dados que já existem (data + valor de cada transação) sem
 * precisar de uma nova infraestrutura de "fotografia da carteira antes de
 * cada fluxo de caixa" que o TWR exigiria.
 *
 * Algoritmo: Newton-Raphson a partir de um chute inicial de 10% a.a.; se não
 * convergir (chute ruim, derivada perto de zero), cai pra busca binária num
 * intervalo amplo (-99,99% a +100.000% a.a.) como segunda tentativa. Devolve
 * `null` quando não há solução matematicamente estável: menos de 2 fluxos não
 * nulos, todos os fluxos com o mesmo sinal (nenhuma "saída" pra comparar com
 * "entrada" — ex. ativo sem preço atual definido, ver §8.17), ou nenhuma das
 * duas tentativas numéricas converge.
 */
export function calcularXIRR(fluxos: FluxoCaixaXIRR[]): number | null {
  const validos = fluxos.filter((f) => f.valor !== 0);
  if (validos.length < 2) return null;

  const temPositivo = validos.some((f) => f.valor > 0);
  const temNegativo = validos.some((f) => f.valor < 0);
  if (!temPositivo || !temNegativo) return null;

  const ordenados = [...validos].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  const dataBase = ordenados[0].data;

  let taxa = 0.1;
  let convergiu = false;
  for (let i = 0; i < XIRR_MAX_ITERACOES_NEWTON; i++) {
    const vpl = valorPresenteLiquidoXIRR(ordenados, taxa, dataBase);
    const derivada = derivadaValorPresenteLiquidoXIRR(ordenados, taxa, dataBase);
    if (derivada === 0) break;
    const proximaTaxa = taxa - vpl / derivada;
    if (!Number.isFinite(proximaTaxa) || proximaTaxa <= -0.999999) break;
    if (Math.abs(proximaTaxa - taxa) < XIRR_TOLERANCIA) {
      taxa = proximaTaxa;
      convergiu = true;
      break;
    }
    taxa = proximaTaxa;
  }

  // Chute do Newton-Raphson convergiu mas fugiu pra uma faixa sem sentido
  // prático (ex. >100.000% a.a.) — trata como não convergido e cai pra
  // busca binária, mais lenta porém sempre estável quando existe raiz.
  if (convergiu && taxa > -0.999999 && taxa < 1000 && Number.isFinite(taxa)) {
    return taxa * 100;
  }

  let baixo = -0.9999;
  let alto = 1000;
  const vplBaixo = valorPresenteLiquidoXIRR(ordenados, baixo, dataBase);
  const vplAlto = valorPresenteLiquidoXIRR(ordenados, alto, dataBase);
  if (vplBaixo === 0) return baixo * 100;
  if (vplAlto === 0) return alto * 100;
  if (Math.sign(vplBaixo) === Math.sign(vplAlto)) return null;

  let taxaBissecao = (baixo + alto) / 2;
  for (let i = 0; i < XIRR_MAX_ITERACOES_BISSECAO; i++) {
    taxaBissecao = (baixo + alto) / 2;
    const vplMeio = valorPresenteLiquidoXIRR(ordenados, taxaBissecao, dataBase);
    if (Math.abs(vplMeio) < XIRR_TOLERANCIA) break;
    if (Math.sign(vplMeio) === Math.sign(vplBaixo)) {
      baixo = taxaBissecao;
    } else {
      alto = taxaBissecao;
    }
  }

  return Number.isFinite(taxaBissecao) ? taxaBissecao * 100 : null;
}

/**
 * Constrói os fluxos de caixa (data + valor assinado) de uma sequência de
 * transações JÁ ORDENADAS — insumo de `calcularXIRR`. Reaproveita a MESMA
 * lógica de `aplicarTransacaoNaPosicao` (inclusive o clamp de venda corrigido
 * em §8.60 — `Math.min(quantidade, estado.quantidade)`) em vez de
 * `valorCaixaTransacao`, que não conhece o estado da posição e não protege
 * contra vender mais do que o saldo (relevante sob filtro de corretora, ver
 * lib/carteira/posicao.ts). Eventos societários (desdobramento/grupamento/
 * bonificação) nunca entram — não há caixa de verdade entrando ou saindo,
 * mesma convenção de `valorCaixaTransacao`.
 */
export function construirFluxosCaixaXIRR(transacoesOrdenadas: TransacaoCalc[]): FluxoCaixaXIRR[] {
  const fluxos: FluxoCaixaXIRR[] = [];
  let estado = ESTADO_POSICAO_INICIAL;
  for (const t of transacoesOrdenadas) {
    if (t.tipo === "compra") {
      const valorComprado = (t.quantidade ?? 0) * (t.precoUnitario ?? 0) + (t.custos ?? 0);
      if (valorComprado !== 0) fluxos.push({ data: t.data, valor: -valorComprado });
    } else if (t.tipo === "venda") {
      const qtdVenda = Math.min(t.quantidade ?? 0, estado.quantidade);
      const valorVendido = qtdVenda * (t.precoUnitario ?? 0) - (t.custos ?? 0);
      if (valorVendido !== 0) fluxos.push({ data: t.data, valor: valorVendido });
    }
    estado = aplicarTransacaoNaPosicao(estado, t);
  }
  return fluxos;
}
