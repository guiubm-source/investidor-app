import type { TipoAtivo } from "./actions";

/**
 * Tipos elegíveis pro "cartão de visita" de empresa (CNPJ/nome/logo/segmento)
 * — fase 4 do card de empresa (ver docs/MAPA-DE-DADOS.md §8.56). Escopo
 * decidido com o Guilherme: Ações/FIIs/ETF Brasil + Internacional (ação/
 * ETF/REIT exterior). Renda fixa, fundo, cripto e outro ficam de fora por
 * ora — não têm "empresa" no sentido tradicional (emissor/gestora/
 * instituição é um conceito diferente, não modelado nesta fase).
 */
export const TIPOS_CARTAO_EMPRESA: TipoAtivo[] = ["acao", "fii", "etf", "internacional"];

export type DadosEmpresa = {
  cnpj: string | null;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  logoUrl: string | null;
  segmento: string | null;
  descricao: string | null;
};

export type ResultadoDadosEmpresa = DadosEmpresa | { erro: string };

const USER_AGENT_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/**
 * Busca dados cadastrais (CNPJ, nome, logo, segmento) de uma Ação/FII/ETF B3
 * via brapi.dev — ver docs/MAPA-DE-DADOS.md §8.56. Sem `BRAPI_TOKEN`
 * configurado (variável de ambiente), a API só cobre 4 tickers de teste
 * (PETR4, MGLU3, VALE3, ITUB4); pra cobertura completa o Guilherme precisa
 * criar uma conta gratuita em brapi.dev/dashboard e configurar o token —
 * documentado em §8.56, nunca criado por mim (não crio contas em nome do
 * usuário).
 */
export async function buscarDadosEmpresaBrapi(ticker: string): Promise<ResultadoDadosEmpresa> {
  const token = process.env.BRAPI_TOKEN;
  const url = new URL(`https://brapi.dev/api/quote/${encodeURIComponent(ticker.toUpperCase())}`);
  url.searchParams.set("modules", "summaryProfile");
  if (token) url.searchParams.set("token", token);

  try {
    const resposta = await fetch(url.toString(), { cache: "no-store" });
    if (!resposta.ok) {
      return { erro: `brapi.dev retornou ${resposta.status} para ${ticker} — verifique o token em BRAPI_TOKEN.` };
    }

    const corpo = await resposta.json();
    const resultado = corpo?.results?.[0];
    if (!resultado) {
      return { erro: `brapi.dev não encontrou dados cadastrais para ${ticker}.` };
    }

    const perfil = resultado.summaryProfile ?? {};

    return {
      cnpj: resultado.cnpj ?? perfil.cnpj ?? null,
      razaoSocial: resultado.longName ?? null,
      nomeFantasia: resultado.shortName ?? null,
      logoUrl: resultado.logourl ?? null,
      segmento: perfil.sector ?? perfil.industry ?? null,
      descricao: perfil.longBusinessSummary ?? null,
    };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : `Erro desconhecido ao buscar dados cadastrais de ${ticker}.` };
  }
}

/**
 * Busca dados cadastrais de uma ação/ETF/REIT internacional via endpoint
 * não-oficial do Yahoo Finance (`quoteSummary`, módulos `assetProfile` +
 * `quoteType`) — mesmo endpoint não-oficial já usado em `yahoo-finance.ts`
 * pra cotação, mesma tolerância a falha (nunca lança, sempre devolve
 * `{ erro }`). Empresa estrangeira não tem CNPJ (fica sempre `null` aqui).
 * Sem logo direto do Yahoo — usa o website da empresa (quando disponível)
 * como melhor esforço via Clearbit (serviço público de logos por domínio),
 * documentado como aproximação, não fonte oficial.
 */
export async function buscarDadosEmpresaYahoo(ticker: string): Promise<ResultadoDadosEmpresa> {
  const symbol = ticker.trim().toUpperCase();
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile,quoteType`;

  try {
    const resposta = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT_NAVEGADOR, Accept: "application/json" },
    });

    if (!resposta.ok) {
      return { erro: `Yahoo Finance retornou ${resposta.status} para ${symbol}.` };
    }

    const corpo = await resposta.json();
    const resultado = corpo?.quoteSummary?.result?.[0];
    if (!resultado) {
      return { erro: `Yahoo Finance não encontrou dados cadastrais para ${symbol}.` };
    }

    const perfil = resultado.assetProfile ?? {};
    const tipo = resultado.quoteType ?? {};
    const website: string | undefined = perfil.website;
    const dominio = website ? website.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null;

    return {
      cnpj: null,
      razaoSocial: tipo.longName ?? null,
      nomeFantasia: tipo.shortName ?? null,
      logoUrl: dominio ? `https://logo.clearbit.com/${dominio}` : null,
      segmento: perfil.sector ?? perfil.industry ?? null,
      descricao: perfil.longBusinessSummary ?? null,
    };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : `Erro desconhecido ao buscar dados cadastrais de ${symbol}.` };
  }
}

/**
 * Deriva a chave externa usada pra dedupe de `empresas` (ver comentário da
 * tabela em schema.sql §27): CNPJ quando disponível (nacional); ticker
 * limpo em maiúsculo como fallback (nacional sem CNPJ encontrado, ou
 * qualquer internacional, que nunca tem CNPJ). Prefixo `TK:` no fallback
 * evita colisão acidental com um CNPJ de verdade (que nunca começa com
 * letras) de outra empresa.
 */
export function deriveChaveExternaEmpresa(ticker: string, cnpj: string | null): string {
  if (cnpj && cnpj.trim()) return cnpj.trim();
  return `TK:${ticker.trim().toUpperCase()}`;
}
