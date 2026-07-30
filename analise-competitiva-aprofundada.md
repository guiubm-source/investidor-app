# Análise competitiva aprofundada — layout, cálculos e falhas

Complemento do `analise-competitiva.md`. Aqui entrei de verdade nas páginas (naveguei e tirei print de Status Invest e Investidor10 — são as duas com página pública de ativo comparável à sua página de Ativo; Meus Dividendos e MyProfit não expõem esse tipo de página fundamentalista pública, então pra elas fiquei com o que dá pra ver no site institucional). Tudo com ferramentas gratuitas — nenhuma chamada de API paga em lugar nenhum desta pesquisa, e separei no final o que dá pra replicar de graça no seu app do que exigiria dado que você não tem hoje.

## 1. Layout, cores, cards, KPIs — como cada um se posiciona

**Status Invest.** Header verde-azulado (gradiente teal), fundo branco. O primeiro card da fileira de KPIs ("Valor atual") é destacado em um retângulo azul-marinho sólido com texto branco — os outros quatro (Mín. 52 semanas, Máx. 52 semanas, Dividend Yield, Valorização 12m) são cards brancos simples com borda fina. É uma hierarquia visual clara: 1 número "hero" em destaque de cor, o resto em texto neutro. O gráfico de cotação é área preenchida em laranja (não linha fina) — bastante "cheio", chama atenção mesmo em miniatura. Indicadores fundamentalistas ficam agrupados em 5 categorias com cabeçalho de seção (Valuation, Endividamento, Eficiência, Rentabilidade, Crescimento), cada indicador em um cartãozinho com nome + link "format_quote" pra um artigo-glossário dedicado + valor + ícone de gráfico + tooltip com a fórmula. Tem alternância HOJE / HISTÓRICO / MÉDIA MERCADO no topo do bloco de indicadores. Bastante uso de banners de upsell (Status Alpha IA, Forecast) intercalados no meio do conteúdo — o produto pago é visualmente onipresente mesmo pra quem não assina.

**Investidor10.** Visual mais escuro e sóbrio: header preto/marinho com um dourado/bege como cor de destaque (o "PRO" é dourado). Os 5 KPIs do topo (Cotação, Variação 12M, P/L, P/VP, DY) são cards de largura igual, cada um com uma barra de título escura e o valor grande embaixo em branco/preto conforme o card — visualmente mais "quadriculado e uniforme" que o Status Invest, sem hero card diferenciado. Confirmei visualmente: seta verde pra cima em variação positiva. Indicadores fundamentalistas: grid de 6 colunas, cards brancos uniformes, pouquíssima cor (cinza pro rótulo, preto pro valor), separados por categoria com uma linha vertical dourada fininha do lado do título da seção — só isso de cor. Cada card tem um ícone de mini-gráfico no canto inferior direito (abre histórico daquele indicador específico). Tem um toggle "Comparar indicadores" que, quando ligado, mostra ao lado de cada valor a média do Setor/Subsetor/Segmento — desligado por padrão.

**Diferença de personalidade visual:** Status Invest é mais "colorido e vendedor" (teal + laranja + azul-marinho + banners), Investidor10 é mais "arquivo/planilha honesta" (preto/branco/cinza/dourado, grid uniforme). Nenhum dos dois foge muito de card branco + valor grande em negrito — isso já é essencially o padrão que seu app usa. A diferença mais visível é que os dois usam MUITO mais agrupamento por categoria com cabeçalho lateral/superior do que "uma sopa de cards soltos", e os dois anexam um mini-gráfico histórico clicável em cada indicador individual — isso seu checklist hoje não tem.

**Meus Dividendos / Smartfolio** (só site institucional, não visitei a área logada): destaca "dashboard com visualização estática e dinâmica" e "layout personalizável" como diferencial de marketing — ou seja, o próprio produto vende como funcionalidade o fato de o usuário poder reorganizar os cards. Não dá pra saber cores exatas sem logar.

## 2. Cálculos e memórias de cálculo — mecanismos reais

O achado mais importante aqui: **tanto Status Invest quanto Investidor10 constroem seu checklist fundamentalista com o mesmo conjunto de fórmulas-padrão de mercado — e são quase idênticas ao que seu app já calcula.** Copiei as fórmulas exatas que a Status Invest expõe (ela é mais transparente que a Investidor10 — mostra a fórmula direto no tooltip de cada indicador, a Investidor10 só tem um ícone de "?" sem confirmar se abre a fórmula ou só uma descrição):

- **P/L** = Preço atual / Lucro por ação (LPA)
- **P/VP** = Preço atual / Valor patrimonial por ação (VPA)
- **Dividend Yield** = Dividendos pagos no período / Preço da ação — a Status Invest documenta explicitamente que usa valor **bruto**, com **DATA-COM** (não data de pagamento) dentro da janela de 12 meses, e que **amortizações não entram no cálculo**
- **PEG Ratio** = (P/L) / [(LPA últimos 4 trimestres / LPA dos 4 trimestres anteriores a esses) − 1]
- **EV/EBITDA**, **EV/EBIT**, **P/EBITDA**, **P/EBIT** — todos Enterprise-Value-based
- **VPA** = Patrimônio líquido / Nº de ações · **LPA** = Lucro líquido / Nº de ações
- **ROE** = Lucro líquido / Patrimônio líquido · **ROA** = Lucro líquido / Ativo total · **ROIC** = (EBIT − Impostos) / (Patrimônio líquido + Endividamento)
- **Margem Bruta/EBITDA/EBIT/Líquida** = respectivo resultado / Receita líquida
- **Dív. líquida/PL**, **Dív. líquida/EBITDA**, **Dív. líquida/EBIT**, **Liquidez corrente** = Ativo circulante / Passivo circulante
- **CAGR Receitas/Lucros 5 anos** — taxa composta de crescimento anual

Isso é **linha a linha o que já existe no seu `checklist-estatisticas.ts`** (confirmei antes de escrever isso — P/L, PEG, P/VP, ROE, ROA, ROIC, margens, DL/PL, liquidez corrente, CAGR 5 anos já estão todos lá). Ou seja: seu motor de cálculo fundamentalista **já está no nível dos dois concorrentes mais sérios em fundamentos**. O gap não é de fórmula, é de **como você expõe a fórmula pro usuário** — nenhuma das suas cards mostra "FÓRMULA: X/Y" num tooltip como a Status Invest faz. Isso é barato de adicionar (é só texto estático ao lado de cada indicador que você já calcula).

**Preço Justo (Graham e Bazin)** — só a Investidor10 tem isso, e descobri a fórmula exata via busca (não está atrás de paywall, é conteúdo educativo público do próprio site deles):

- **Graham**: Preço Justo = √(22,5 × LPA × VPA) — o 22,5 vem de multiplicar o P/L máximo aceitável por Graham (15) pelo P/VP máximo aceitável (1,5)
- **Bazin**: Preço Justo = Dividendo anual / 0,06 — parte da premissa de que 6% de yield é o "justo" pro investidor

O interessante: **na tela real, a Investidor10 paywalleia o resultado** (mostra "R$ 0,00" e "Descobrir o preço justo desta ação" atrás de um cadeado — só quem paga vê o número). Mas a fórmula em si é 100% pública, e os dois únicos insumos são LPA e VPA (Graham) ou dividendo anual (Bazin) — **dado que seu app já calcula esses dois números**, dá pra implementar isso de graça, sem paywall (faz sentido no seu caso, já que o app é seu, não é produto pra vender assinatura).

**Mecanismo que os dois têm e você não tem:** ícone de gráfico clicável em cada card de indicador individual, que abre a série histórica daquele indicador específico ao longo do tempo (não só o valor atual). Isso também é "de graça" no seu caso — você já guarda resultados trimestrais históricos (sub-aba de Resultados trimestrais na página do Ativo), só falta uma visualização que puxe esse histórico por indicador.

**Mecanismo que exige dado que você não tem de graça:** a comparação "Setor: X / Subsetor: Y / Segmento: Z" da Investidor10 e o "MÉDIA MERCADO" da Status Invest dependem de ter a base fundamentalista de **milhares de empresas listadas**, não só as que você tem na carteira — isso não dá pra replicar sem uma fonte de dados de mercado abrangente (que normalmente é paga). Fica como limitação real, não como "esqueceram de implementar".

## 3. Possíveis falhas — bugs reais relatados + limitações de metodologia

**Bugs relatados por usuários (Reclame Aqui, Investidor10 — não achei volume equivalente pra Status Invest/Meus Dividendos/MyProfit nessa busca):**

- Rentabilidade da carteira aparecendo **completamente divergente entre duas telas do mesmo produto** — um usuário relatou -98,48% no resumo da home enquanto a página detalhada de rentabilidade mostrava +52,68% acumulado pro mesmo período. Isso é sintoma clássico de duas fórmulas de retorno não unificadas, calculadas em lugares diferentes do código, que divergem silenciosamente — exatamente a classe de bug que vocês já corrigiram no seu app mais de uma vez (unificação da fórmula de rentabilidade, correção da fórmula que ignorava principal devolvido em venda). Serve como confirmação de que essa categoria de bug é comum no setor, não uma falha isolada de vocês — e reforça que vale a pena manter o teste automatizado que já existe cobrindo isso.
- Preço médio mudando de um dia pro outro sem uma transação nova ter sido lançada (usuário comprou a ~R$24 e no dia seguinte o preço médio aparecia R$31) — sugere reprocessamento silencioso de eventos societários ou re-sincronização com a integração B3 que recalcula o preço médio sem o usuário entender o porquê.
- A própria Investidor10 reconhece publicamente, na página de suporte, que existe "divergência de quantidade" em ativos por um "problema de dados vindo da B3" que o time está corrigindo — ou seja, mesmo com integração automática, os dados de origem podem vir errados/desincronizados, e isso não é um problema que dá pra resolver só do lado do produto.

**Limitações de metodologia (não são bugs, são premissas que valem a pena você conhecer antes de decidir se quer replicar):**

- A própria Investidor10 avisa, no texto do card de Preço Justo de Graham: "por considerar o valor patrimonial em seu cálculo, a fórmula não funciona bem para empresas de tecnologia" — empresas asset-light (pouco patrimônio, muito intangível) saem com Preço Justo artificialmente baixo.
- A fórmula de Bazin assume 6% de yield "justo" fixo, uma premissa dos anos 1990/2000 que não se ajusta à Selic atual (14,25% conforme os dados que vi hoje) — com juro básico nesse patamar, exigir só 6% de yield de uma ação é um padrão bem mais frouxo do que faria sentido comparado à renda fixa livre de risco. Nenhum dos dois sites ajusta a fórmula dinamicamente pela Selic.
- PEG Ratio usa só duas janelas de 4 trimestres pra estimar "crescimento esperado" — pra empresa cíclica como a própria PETR4 (dependente do preço do petróleo), um trimestre atípico pra cima ou pra baixo distorce o indicador inteiro de forma desproporcional. É um indicador estruturalmente ruidoso para commodities/cíclicas, não um bug, mas vale um aviso na tela se você implementar.
- Dividend Yield calculado por DATA-COM (não pagamento) dentro de uma janela fixa de 12 meses: um provento extraordinário/atípico que caia dentro da janela infla o yield temporariamente, e ele "some" do indicador de uma hora pra outra quando sai da janela de 12 meses — sem qualquer aviso visual de que aquele DY teve um evento fora do padrão puxando o número.

## 4. Resumo: o que dá pra fazer de graça no seu app hoje

| Ideia | Dado que falta | Custo |
|---|---|---|
| Tooltip com fórmula em cada indicador do checklist | Nenhum — é só texto estático | Baixíssimo |
| Preço Justo (Graham e Bazin) na página do Ativo | Nenhum — usa LPA/VPA/dividendo anual que você já calcula | Baixo |
| Gráfico histórico por indicador (clicar e ver evolução do P/L, ROE etc. ao longo do tempo) | Nenhum — você já guarda resultados trimestrais históricos | Baixo/médio (é UI nova sobre dado existente) |
| Aviso de "yield inflado por evento atípico" quando um provento extraordinário está na janela de 12m do DY | Nenhum — é uma regra sobre dado que já existe | Baixo |
| Comparação com média de Setor/Subsetor/Segmento | Base fundamentalista de milhares de empresas do mercado | Alto/inviável sem fonte paga |

Me diga se quer que eu detalhe algum desses pra implementação — sigo o processo normal, uma pergunta de escopo por vez.
