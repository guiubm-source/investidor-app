/**
 * Cálculos derivados da Selic — módulo PURO (sem "use server", sem acesso a
 * banco). Ver docs/MAPA-DE-DADOS.md §8.7, decisão 5: taxa vigente, variação,
 * decisão, sequência, tendência e estatísticas NUNCA são armazenadas — são
 * sempre recalculadas a partir de `indicador_selic_reunioes`. Este arquivo é
 * a fonte única desses cálculos: `lib/indicadores/actions.ts` usa (no
 * servidor, dentro de `obterSelic()`) e o componente de gráfico usa direto
 * no cliente (média móvel, filtros de período) — evita duas implementações
 * divergentes da mesma conta.
 */

export type DecisaoTipo = "alta" | "reducao" | "manutencao";

export type PontoSelic = {
  id: string;
  numeroReuniao: number | null;
  dataInicio: string;
  dataFim: string;
  taxaDefinida: number | null;
};

export type SelicReuniaoDerivada = PontoSelic & {
  decidido: boolean;
  dataVigencia: string | null;
  variacao: number | null;
  decisaoTipo: DecisaoTipo | null;
};

export type SelicEstatisticas = {
  maior: number | null;
  menor: number | null;
  media: number | null;
  mediana: number | null;
  desvioPadrao: number | null;
  amplitude: number | null;
  numAltas: number;
  numReducoes: number;
  numManutencoes: number;
  maiorAumento: number | null;
  maiorReducao: number | null;
  tempoMedioEntreReunioesDias: number | null;
  tempoMedioVigenciaDias: number | null;
};

export function adicionarDias(dataIso: string, dias: number): string {
  const d = new Date(`${dataIso}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Aproximação: "primeiro dia útil após a reunião" sem calendário de feriados — usamos data_fim + 1 dia corrido. */
export function calcularDataVigencia(dataFim: string): string {
  return adicionarDias(dataFim, 1);
}

export function diasEntre(dataInicioIso: string, dataFimIso: string): number {
  const a = new Date(`${dataInicioIso}T00:00:00`).getTime();
  const b = new Date(`${dataFimIso}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

export function calcularDecisaoTipo(variacao: number): DecisaoTipo {
  if (variacao > 0) return "alta";
  if (variacao < 0) return "reducao";
  return "manutencao";
}

/** Recebe reuniões em qualquer ordem, devolve ordenadas ASC por data_inicio com os campos derivados calculados. */
export function derivarReunioes(pontos: PontoSelic[]): SelicReuniaoDerivada[] {
  const ordenados = [...pontos].sort((a, b) => a.dataInicio.localeCompare(b.dataInicio));
  const resultado: SelicReuniaoDerivada[] = [];
  let taxaAnterior: number | null = null;

  for (const p of ordenados) {
    const decidido = p.taxaDefinida !== null;
    let variacao: number | null = null;
    let decisaoTipo: DecisaoTipo | null = null;

    if (decidido) {
      if (taxaAnterior !== null) {
        variacao = Number((p.taxaDefinida! - taxaAnterior).toFixed(2));
        decisaoTipo = calcularDecisaoTipo(variacao);
      }
      taxaAnterior = p.taxaDefinida!;
    }

    resultado.push({
      ...p,
      decidido,
      dataVigencia: decidido ? calcularDataVigencia(p.dataFim) : null,
      variacao,
      decisaoTipo,
    });
  }

  return resultado;
}

/** Conta quantas decisões seguidas (a partir da mais recente) foram do mesmo tipo. */
export function calcularSequenciaConsecutiva(
  reunioesAsc: SelicReuniaoDerivada[]
): { tipo: DecisaoTipo; quantidade: number } | null {
  const comDecisao = reunioesAsc.filter((r) => r.decisaoTipo !== null);
  if (comDecisao.length === 0) return null;

  const ultimoTipo = comDecisao[comDecisao.length - 1].decisaoTipo!;
  let quantidade = 0;
  for (let i = comDecisao.length - 1; i >= 0; i--) {
    if (comDecisao[i].decisaoTipo !== ultimoTipo) break;
    quantidade++;
  }
  return { tipo: ultimoTipo, quantidade };
}

export function calcularEstatisticas(reunioesAsc: SelicReuniaoDerivada[]): SelicEstatisticas {
  const decididas = reunioesAsc.filter((r) => r.decidido);
  const taxas = decididas.map((r) => r.taxaDefinida!);

  if (taxas.length === 0) {
    return {
      maior: null,
      menor: null,
      media: null,
      mediana: null,
      desvioPadrao: null,
      amplitude: null,
      numAltas: 0,
      numReducoes: 0,
      numManutencoes: 0,
      maiorAumento: null,
      maiorReducao: null,
      tempoMedioEntreReunioesDias: null,
      tempoMedioVigenciaDias: null,
    };
  }

  const maior = Math.max(...taxas);
  const menor = Math.min(...taxas);
  const media = taxas.reduce((s, t) => s + t, 0) / taxas.length;
  const taxasOrdenadas = [...taxas].sort((a, b) => a - b);
  const meio = Math.floor(taxasOrdenadas.length / 2);
  const mediana =
    taxasOrdenadas.length % 2 === 0
      ? (taxasOrdenadas[meio - 1] + taxasOrdenadas[meio]) / 2
      : taxasOrdenadas[meio];
  const variancia = taxas.reduce((s, t) => s + (t - media) ** 2, 0) / taxas.length;
  const desvioPadrao = Math.sqrt(variancia);
  const amplitude = maior - menor;

  let numAltas = 0;
  let numReducoes = 0;
  let numManutencoes = 0;
  let maiorAumento: number | null = null;
  let maiorReducao: number | null = null;

  for (const r of decididas) {
    if (r.decisaoTipo === "alta") {
      numAltas++;
      if (maiorAumento === null || r.variacao! > maiorAumento) maiorAumento = r.variacao!;
    } else if (r.decisaoTipo === "reducao") {
      numReducoes++;
      if (maiorReducao === null || r.variacao! < maiorReducao) maiorReducao = r.variacao!;
    } else if (r.decisaoTipo === "manutencao") {
      numManutencoes++;
    }
  }

  let tempoMedioEntreReunioesDias: number | null = null;
  if (decididas.length >= 2) {
    const intervalos: number[] = [];
    for (let i = 1; i < decididas.length; i++) {
      intervalos.push(diasEntre(decididas[i - 1].dataInicio, decididas[i].dataInicio));
    }
    tempoMedioEntreReunioesDias = intervalos.reduce((s, d) => s + d, 0) / intervalos.length;
  }

  let tempoMedioVigenciaDias: number | null = null;
  if (decididas.length >= 1) {
    const hoje = new Date().toISOString().slice(0, 10);
    const vigencias: number[] = [];
    for (let i = 0; i < decididas.length; i++) {
      const inicio = decididas[i].dataVigencia!;
      const fim = i + 1 < decididas.length ? decididas[i + 1].dataVigencia! : hoje;
      vigencias.push(Math.max(0, diasEntre(inicio, fim)));
    }
    tempoMedioVigenciaDias = vigencias.reduce((s, d) => s + d, 0) / vigencias.length;
  }

  return {
    maior,
    menor,
    media,
    mediana,
    desvioPadrao,
    amplitude,
    numAltas,
    numReducoes,
    numManutencoes,
    maiorAumento,
    maiorReducao,
    tempoMedioEntreReunioesDias,
    tempoMedioVigenciaDias,
  };
}

/** Média móvel simples sobre uma série (nulos propagam nulo na janela). */
export function calcularMediaMovel(taxas: (number | null)[], periodo: number): (number | null)[] {
  if (periodo < 1) return taxas.map(() => null);
  const resultado: (number | null)[] = [];
  for (let i = 0; i < taxas.length; i++) {
    if (i < periodo - 1) {
      resultado.push(null);
      continue;
    }
    const janela = taxas.slice(i - periodo + 1, i + 1);
    if (janela.some((t) => t === null)) {
      resultado.push(null);
      continue;
    }
    const soma = (janela as number[]).reduce((s, t) => s + t, 0);
    resultado.push(Number((soma / periodo).toFixed(4)));
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Importação (colar texto) — parser puro; quem grava no banco é
// lib/indicadores/actions.ts#importarHistoricoSelic.
// ---------------------------------------------------------------------------

export type LinhaImportacaoSelic = { numeroReuniao: number | null; data: string; taxa: number };
export type ResultadoParseImportacao = { linhas: LinhaImportacaoSelic[]; erros: string[] };

/**
 * Aceita colunas separadas por TAB ou por 2+ espaços, no formato
 * "REUNIÃO  DATA  SELIC" (3 colunas) ou "DATA  SELIC" (2 colunas, sem
 * numeração oficial). Data em DD/MM/AAAA ou AAAA-MM-DD. Taxa aceita vírgula
 * ou ponto como separador decimal. Ignora uma linha de cabeçalho se a
 * primeira palavra for "reunião" (com ou sem acento).
 */
export function parseImportacaoSelic(texto: string): ResultadoParseImportacao {
  const erros: string[] = [];
  const linhasTexto = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const linhas: LinhaImportacaoSelic[] = [];
  const datasVistas = new Set<string>();
  const numerosVistos = new Set<number>();
  const hoje = new Date().toISOString().slice(0, 10);

  linhasTexto.forEach((linhaOriginal, idx) => {
    if (/^reuni[aã]o\b/i.test(linhaOriginal)) return;

    const colunas = linhaOriginal
      .split(/\t+|\s{2,}/)
      .map((c) => c.trim())
      .filter(Boolean);

    if (colunas.length < 2) {
      erros.push(`Linha ${idx + 1}: não foi possível separar as colunas ("${linhaOriginal}").`);
      return;
    }

    let numeroTexto: string | null = null;
    let dataTexto: string;
    let taxaTexto: string;
    if (colunas.length >= 3) {
      [numeroTexto, dataTexto, taxaTexto] = colunas;
    } else {
      [dataTexto, taxaTexto] = colunas;
    }

    let numeroReuniao: number | null = null;
    if (numeroTexto) {
      const n = Number(numeroTexto.replace(/[^\d]/g, ""));
      if (!Number.isFinite(n) || n <= 0) {
        erros.push(`Linha ${idx + 1}: número de reunião inválido ("${numeroTexto}").`);
        return;
      }
      numeroReuniao = n;
    }

    const matchBr = dataTexto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const matchIso = dataTexto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let dataIso: string;
    if (matchBr) {
      const [, dd, mm, aaaa] = matchBr;
      dataIso = `${aaaa}-${mm}-${dd}`;
    } else if (matchIso) {
      dataIso = dataTexto;
    } else {
      erros.push(`Linha ${idx + 1}: data inválida ("${dataTexto}"). Use DD/MM/AAAA ou AAAA-MM-DD.`);
      return;
    }

    if (dataIso > hoje) {
      erros.push(`Linha ${idx + 1}: data futura não permitida ("${dataTexto}").`);
      return;
    }

    const taxa = Number(taxaTexto.replace(",", "."));
    if (!Number.isFinite(taxa) || taxa < 0) {
      erros.push(`Linha ${idx + 1}: taxa Selic inválida ("${taxaTexto}").`);
      return;
    }

    if (datasVistas.has(dataIso)) {
      erros.push(`Linha ${idx + 1}: data duplicada dentro do texto colado ("${dataTexto}").`);
      return;
    }
    if (numeroReuniao !== null) {
      if (numerosVistos.has(numeroReuniao)) {
        erros.push(`Linha ${idx + 1}: número de reunião duplicado dentro do texto colado (${numeroReuniao}).`);
        return;
      }
      numerosVistos.add(numeroReuniao);
    }
    datasVistas.add(dataIso);

    linhas.push({ numeroReuniao, data: dataIso, taxa });
  });

  linhas.sort((a, b) => a.data.localeCompare(b.data));

  return { linhas, erros };
}
