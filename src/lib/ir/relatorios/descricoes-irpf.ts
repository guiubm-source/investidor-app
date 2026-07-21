/**
 * Textos fixos do PDF final (fase 11, §8.32.26) — disclaimer e instruções de
 * uso no programa oficial. Constantes puras (sem cálculo, sem DB) — vivem
 * separadas do motor (`motores/relatorio-completo.ts`) só pra não misturar
 * texto longo com lógica de agregação, seguindo a organização sugerida em
 * §8.32.29 (`relatorios/descricoes-irpf.ts`).
 */

export const DISCLAIMER_RELATORIO: string[] = [
  "Este é um relatório AUXILIAR gerado pelo App do Investidor — não é consultoria tributária e não substitui um contador.",
  "O app não transmite a declaração à Receita Federal. Todo valor aqui precisa ser conferido e digitado manualmente no programa oficial (ou no e-CAC).",
  "Day trade é detectado por aproximação (compra e venda do mesmo ativo no mesmo dia), não por casamento real de ordens da corretora.",
  "Seções marcadas \"não disponível ainda\" não têm motor de cálculo construído nesta versão do app — não foram esquecidas nem zeradas, simplesmente ainda não existem. Não trate a ausência como \"sem valor a declarar\".",
  "Confira todos os números com um contador antes de declarar, especialmente pendências e itens sem comprovante listados abaixo.",
];

export const INSTRUCOES_USO_PROGRAMA_OFICIAL: string[] = [
  "Bens e Direitos: use grupo/código e a discriminação sugerida de cada item para preencher a ficha \"Bens e Direitos\" do programa oficial. Situação em 31/12 do ano anterior e situação em 31/12 do ano-calendário vêm prontas.",
  "Rendimentos isentos e Tributação exclusiva: os valores de renda fixa (isenta e tributável) e as vendas de ações/FII isentas por limite mensal alimentam essas duas fichas — cada linha já indica o motivo da isenção quando aplicável.",
  "Renda variável mês a mês: alimenta a ficha \"Renda Variável\" — use o resumo mensal (valor para copiar); a coluna de prejuízo compensado é só memória auxiliar.",
  "Aplicações financeiras no exterior: alimenta a ficha de ganho de capital do exterior (Lei 14.754) — o imposto devido do ano é o valor a recolher via DARF próprio dessa lei, separado do DARF de renda variável Brasil.",
  "Resumo de DARFs: cada guia consolidada mostra o código de receita e a competência de geração — gere o DARF correspondente no site da Receita Federal (Sicalc) usando esses dados.",
  "Pendências: nenhuma venda/ativo listado aqui entrou nos totais acima — resolva a pendência (classificar day trade, cadastrar câmbio) e gere o relatório de novo antes de declarar.",
];
