# Revisão geral do app — achados e perguntas de melhoria (2026-07-14)

Revisão de ponta a ponta da lógica do app (Carteira, Ativos, Alocação,
Proventos, Imposto de Renda, Indicadores), lendo o código real (não só a
documentação) em busca de bugs, brechas e oportunidades de melhoria. Este
documento tem duas partes: **achados concretos** (coisas que já são erro ou
inconsistência hoje, verificadas no código) e **perguntas por área** (rumos
de melhoria que dependem de uma decisão sua antes de eu implementar, seguindo
o processo do `CLAUDE.md`).

Nada aqui foi implementado ainda — é levantamento, não execução.

## Achados concretos (bugs e brechas já confirmados no código)

1. **ETF sai do relatório de Imposto de Renda sem aviso.**
   `lib/ir/actions.ts#categoriaDoAtivo` trata `acao`, `fundo`, `fii`,
   `renda_fixa`, `cripto`, `internacional` — mas não o tipo `etf` (criado
   depois, na feature "Ativo avançado"). Cai no `default: return null`:
   vendas de ETF simplesmente não aparecem no relatório de IR, sem erro nem
   aviso na tela.
2. **"Fundo de investimento" tributado como ação.** O tipo `fundo` (Fundo de
   investimento, diferente de ETF) segue hoje a mesma regra de swing/day
   trade das ações (15%/20% + isenção de R$20.000/mês). Fundos de
   investimento comuns (multimercado, ações via cotas etc.) costumam ter
   retenção na fonte pelo administrador e regra de come-cotas — bem
   diferente de ação. Pode estar incorreto pra esse tipo específico.
3. **Prejuízo acumulado não atravessa virada de ano.**
   `obterRelatorioIR(ano)` reinicia `prejuizoAcumuladoPorCategoria` do zero
   a cada ano consultado. A lei permite compensar prejuízo de renda
   variável indefinidamente entre anos-calendário — um prejuízo apurado em
   dezembro deveria abater o lucro de janeiro do ano seguinte, e hoje não
   abate no relatório.
4. **Venda retroativa não é validada no ponto certo no tempo.**
   `criarTransacao` (Carteira) valida a quantidade da venda contra a
   posição agregada final (`obterAtivosComPosicao()`), não contra a posição
   que existia na data daquela transação. Lançar uma venda com data
   anterior a uma compra (ambas retroativas) pode passar despercebido; o
   motor de custo médio (`Math.min` em `calcularPosicao`) reduz a
   quantidade vendida silenciosamente em vez de avisar.
5. **Proventos não têm edição.** Existe `criarProvento` e `excluirProvento`,
   mas nenhum `editarProvento` — corrigir um valor digitado errado exige
   excluir e recriar o lançamento.
6. **Exclusão inconsistente entre telas.** `excluirAtivo`, `excluirClasse` e
   `excluirSetor` pedem confirmação (segundo clique numa caixa própria).
   `excluirCorretora`, `excluirProvento`, `excluirTransacao` e
   `excluirResultadoTrimestral` disparam direto no primeiro clique, sem
   nenhuma confirmação.
7. **Peso-alvo sem validação de soma.** Nada impede cadastrar setores de uma
   mesma classe (ou classes) cuja soma dos pesos-alvo não feche em 100% —
   o app aceita e só mostra o desvio calculado em cima disso, sem avisar
   que a base de comparação está inconsistente.
8. **Zero `loading.tsx`/`error.tsx`/`not-found.tsx`.** Nenhuma rota do app
   tem tratamento de erro ou tela de carregamento no nível do Next.js — se
   uma consulta ao Supabase falhar, o comportamento depende de cada
   componente individualmente, sem uma rede de segurança comum.
9. **Zero testes automatizados.** Não há Jest/Vitest/Playwright configurado
   — toda verificação hoje depende de `tsc --noEmit` + `eslint` +
   conferência manual, inclusive nos motores de cálculo financeiro
   (custo médio, IR, checklist, Selic/IPCA/Dólar).
10. **JCP vs. Dividendo continuam genéricos.** Já documentado no mapa de
    dados, reforçando aqui: dividendo é isento de IR, JCP tem retenção de
    15% na fonte — o app trata os dois como "provento" sem distinguir.
11. **Dados de Indicadores/Referência sem `profile_id`.** Selic, IPCA,
    Dólar, Fluxo estrangeiro, Diretoria do Bacen e Presidentes do Brasil
    usam RLS `auth.role() = 'authenticated'` (sem dono) — qualquer usuário
    autenticado pode editar o dado de todo mundo. Aceitável hoje (uso
    pessoal), mas vira um problema real se o app ganhar mais de um usuário.

## Perguntas por área (mínimo 5 cada)

### 1. Investimentos

1. Quer alertas de rebalanceamento automáticos (ex.: aviso quando um ativo
   ultrapassa a tolerância de desvio configurada), em vez de só mostrar a
   barra de desvio quando você entra na tela?
2. Vale travar/validar que a soma dos pesos-alvo feche em 100% em cada
   nível (classes entre si, setores de uma mesma classe), com aviso na
   hora do cadastro (ver achado 7)?
3. Quer histórico de preço diário por ativo (hoje só existe o preço atual)
   pra calcular rentabilidade real ao longo do tempo, não só "desde a
   compra até hoje"?
4. Faz sentido registrar taxa de administração/custódia recorrente da
   corretora, separada dos custos por transação, pra medir o efeito real
   no retorno líquido da carteira?
5. Quer um "aporte sugerido" — calcular quanto aportar em cada
   ativo/setor no próximo aporte pra convergir mais rápido ao peso-alvo,
   em vez de só mostrar o desvio atual?
6. O checklist comparativo hoje cobre só Ações/ETF e FIIs — quer um
   equivalente pra renda fixa (ex. yield to maturity, duration) ou cripto?

### 2. Economia

1. Quer estender a automação via API do Bacen (hoje só o Dólar é
   automático) pra Selic e IPCA também, revendo a decisão de mantê-los
   manuais?
2. Vale automatizar o Fluxo Estrangeiro, mesmo sem API oficial do Bacen
   (via um agregador como dadosdemercado.com.br, com o risco de fonte não
   oficial documentado)?
3. Quer que eu crie o indicador de CDI (candidato natural já mencionado no
   mapa, com API do Bacen SGS disponível), tanto pra comparar com
   Dólar/Selic quanto pra usar como referência de rentabilidade de renda
   fixa pós-fixada (% do CDI)?
4. A "leitura interpretativa combinada" da Visão Geral de Indicadores
   (ex.: juro alto + inflação acima da meta + dólar em alta = cenário de
   cautela) é regra fixa hoje — quer evoluir pra algo mais dinâmico ou
   configurável, ou está bom como está?
5. Quer cruzar os indicadores macro com a Carteira de verdade — por
   exemplo, quanto da carteira está em renda fixa pós-fixada vs.
   prefixada, e como isso reagiria a um corte de Selic?
6. Vale adicionar um indicador de risco-país (CDS/EMBI+), já que ele afeta
   diretamente o câmbio e o apetite por ativos brasileiros?

### 3. Contabilidade / Imposto de Renda

1. Confirma que "Fundo de investimento" (tipo `fundo`) deveria seguir a
   mesma regra de swing/day trade das ações? Ou tem regime próprio
   (come-cotas, retenção na fonte pelo administrador) que eu deveria
   modelar separado (ver achado 2)?
2. O tipo `etf` ficou de fora do motor de IR (achado 1) — confirma que ETF
   segue a regra de ações, mas **sem** a isenção de R$20.000/mês (regra
   real da Receita Federal — isenção vale só pra ações, não pra ETF/BDR),
   pra eu corrigir dessa forma?
3. Quer que eu resolva o prejuízo acumulado não atravessar virada de ano
   (achado 3) — a compensação deveria valer indefinidamente entre
   anos-calendário, sem "zerar" em 1º de janeiro?
4. Quer diferenciar JCP (retenção de 15% na fonte) de dividendo (isento) no
   cadastro de Proventos e no relatório de IR, em vez do genérico atual
   (achado 10)?
5. Quer que eu gere um resumo pronto pra declarar (formato próximo do
   GCAP pra internacional/cripto, ou um resumo mensal formatado pro
   DARF), em vez de só mostrar os números na tela?
6. Hoje não existe lembrete de vencimento de DARF (até o último dia útil
   do mês seguinte) nem o código da guia (6015 ações, 4600 cripto) —
   quer um checklist/lembrete mensal de pagamento?

### 4. UX/UI

1. Exclusão de corretora, provento, transação e resultado trimestral não
   pedem confirmação, diferente de ativo/classe/setor (achado 6) — quer
   que eu padronize com confirmação em todas as exclusões?
2. Quer telas de carregamento (`loading.tsx`) e de erro (`error.tsx`) por
   rota (achado 8), pra evitar tela em branco se uma consulta falhar?
3. Tabelas densas (Resultados trimestrais, Checklist comparativo) hoje só
   rolam horizontalmente no celular — já testou o app no celular? Quer uma
   versão em cards empilhados pra essas telas no mobile?
4. Quer confirmação visual (toast/snackbar) depois de salvar/excluir, em
   vez de a tela só atualizar silenciosamente?
5. Já que não dá pra editar provento (achado 5), tem preferência de fluxo
   pra corrigir erro de digitação, ou tudo bem eu simplesmente adicionar
   edição?
6. Quer um modo claro (light mode)? Hoje o app é só dark, sem alternância
   de tema.

### 5. Front-end

1. Quer testes automatizados (Vitest, por exemplo) pelo menos nos motores
   de cálculo puros — `checklist-estatisticas.ts`, `lib/ir/actions.ts`,
   `selic-estatisticas.ts`, `ipca-estatisticas.ts` — que são funções sem
   efeito colateral e mais fáceis/valiosas de testar primeiro (achado 9)?
2. Quer que eu adicione `error.tsx`/`not-found.tsx` padrão do Next.js
   (achado 8), mesmo sem loading.tsx customizado por tela?
3. Todo dado é buscado de novo a cada navegação (Server Components sem
   cache). Quer que eu avalie `revalidatePath`/cache pra reduzir
   round-trips ao Supabase, especialmente nas telas com `Promise.all`
   pesado (Ativo avançado, Indicadores)?
4. Quer paginação nas listas que crescem sem limite (transações,
   proventos, resultados trimestrais), já que hoje tudo é carregado de
   uma vez só?
5. O `next build` completo não roda neste ambiente (sem rede pro binário
   do SWC) — só valido com `tsc`+`eslint`. Quer que eu configure um
   GitHub Action rodando `next build` de verdade a cada push, pra pegar
   erros que só aparecem no build real antes de ir pra produção?
6. Os formatadores (`formatarMoeda`, `formatarPct`, `formatarRatio` etc.)
   estão duplicados em pelo menos 6 arquivos de view. Quer que eu
   centralize isso num `lib/format.ts` compartilhado, reduzindo o risco de
   um formatador divergir do outro com o tempo?
