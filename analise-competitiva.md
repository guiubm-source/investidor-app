# Análise competitiva — Status Invest, Meus Dividendos, MyProfit, Investidor10

Levantamento do que essas quatro plataformas oferecem e que ainda não existe no App do Investidor, feito visitando os sites e cruzando com o que já foi confirmado no código (não é achismo — cada gap abaixo foi checado no repositório antes de entrar nesta lista). A ideia é você escolher o que faz sentido; nada foi implementado.

## O que cada concorrente traz de mais relevante

**Status Invest** reformulou a área logada em 2025/2026: uma única página de Carteira com abas (Patrimônio, Proventos, Metas, Subcarteiras, Composição, Rentabilidade, Configurações) em vez de telas separadas. Tem alerta de preço/múltiplos e um módulo "Forecast" nos planos pagos.

**Meus Dividendos / Smartfolio** aposta em três coisas que não vi em nenhum dos outros três: dashboard com layout customizável (o usuário arrasta os painéis), uma visão de alocação com "linha do tempo" (arrasta pro lado e vê a composição da carteira em qualquer data passada), e um "inbox" de fatos relevantes resumidos por IA. Também tem agenda de dividendos dedicada (calendário, não só histórico).

**MyProfit** é focado quase 100% em imposto de renda como diferencial: apuração mensal automática com DARF pronto, e principalmente um gerador de arquivo pronto para importar direto no programa da Receita Federal (não é só um PDF/informe pra copiar). Também integra bolsas de cripto (Mercado Bitcoin, Foxbit, Bitybank, Ripio) e várias corretoras BR/EUA automaticamente.

**Investidor10** tem o conjunto mais amplo de "extras" comportamentais: metas financeiras (liberdade financeira), rebalanceamento inteligente (sugestão de ação, não só o desvio), "Isentômetro" (acompanha mês a mês se você está dentro da faixa de isenção de R$20k/R$35k), Preço Justo (Graham e Bazin) na página do ativo, um chat de IA, gamificação (conquistas), e também gera arquivo de declaração pronto pra importar na Receita.

## Gaps confirmados no seu app (checados no código antes de listar)

Cada item abaixo eu confirmei que **não existe hoje** no app do Investidor — não é achismo do concorrente, é comparação real.

**1. Metas financeiras / liberdade financeira.** Hoje "Metas" no seu app é só a árvore de alocação-alvo (estrutura, não objetivo pessoal tipo "quero R$1M até 2035"). Investidor10 e Status Invest têm isso como aba própria.

**2. Rebalanceamento com sugestão de ação.** Sua Alocação já calcula desvio e tem um perfil-sugestão de %-alvo — mas não chega a dizer "compre R$X de tal ativo pra corrigir". Isso é o que o Investidor10 chama de rebalanceamento inteligente.

**3. Agenda de proventos (calendário futuro).** Proventos hoje é histórico + grade estilo planilha; não existe uma visão tipo calendário mostrando "dia 15 você deve receber X de tal ativo" antes de acontecer. Meus Dividendos e Investidor10 têm isso.

**4. Alerta de preço.** Não existe em nenhum lugar do app. Status Invest (plano Bull) e MyProfit têm.

**5. Arquivo de declaração pronto para importar na Receita Federal.** Seu módulo de IR já é o mais profundo dos cinco em termos de motor de cálculo (day trade, DARF, renda fixa, exterior, bens e direitos, PDF completo) — mas gera PDF/instruções pra digitar manualmente, não um arquivo importável direto no programa oficial da Receita. MyProfit e Investidor10 fazem isso e é o principal argumento de venda dos dois.

**6. "Isentômetro" (medidor de isenção mensal).** A regra de isenção de R$20k (FIIs)/R$35k (ações) já existe internamente no motor fiscal, mas não como um widget visual mês a mês tipo "você já vendeu R$12k este mês, faltam R$8k pra estourar a isenção". É um recorte de UI de algo que você já calcula.

**7. Alocação histórica (linha do tempo).** Sua Alocação mostra o estado atual; não dá pra "voltar no tempo" e ver como a alocação estava há 6 meses. Feature do Meus Dividendos.

**8. Integração automática com corretora/B3.** Hoje é cadastro manual + importação por copiar-e-colar. Todos os 4 concorrentes vendem integração automática como diferencial — mas isso é o gap mais caro/estrutural da lista (depende de acordo com corretora ou parser de layout de nota, não é só front-end).

**9. Preço Justo (Graham/Bazin) na página do Ativo.** Seu checklist já tem P/L, P/VP, ROE etc. — só falta esse número específico calculado e mostrado.

**10. Multi-carteira / subcarteiras.** Hoje é uma carteira por usuário (schema não tem esse conceito). Status Invest e Meus Dividendos oferecem múltiplas carteiras.

**11. Dashboard com layout customizável (arrastar painéis).** Ideia do Meus Dividendos; no seu app o layout do Dashboard é fixo.

**12. Chat IA / insights automáticos.** Diferencial do Investidor10; não existe hoje.

## O que eu deixaria de fora (ou trataria com ressalva)

- Gamificação/conquistas (Investidor10): faz sentido pra um produto multi-usuário competindo por engajamento; pra um app pessoal seu, valor baixo.
- App mobile nativo: os 4 têm; é uma frente de trabalho bem maior (não é "mais uma tela"), citando só pra registrar que existe como gap, não como algo pra decidir agora.
- Multi-carteira: só relevante se você quiser separar patrimônio próprio de terceiros/família dentro da mesma conta — se não é o caso, é esforço de schema sem necessidade real.

## Como eu sugiro decidir

Separei mentalmente em três grupos por esforço, mas a escolha é sua:

- **Baratos e isolados** (não mexem em fluxo de dados existente): Preço Justo na página do Ativo, Isentômetro (é UI sobre cálculo que já existe), alerta de preço simples.
- **Médios** (mexem em uma aba, mas com escopo dado): Metas financeiras (nova entidade + UI), agenda de proventos (visão nova sobre dado que já existe), rebalanceamento com sugestão de ação (regra nova sobre a Alocação).
- **Caros/estruturais** (tocam schema ou dependem de terceiro): arquivo de declaração importável na Receita (formato .DEC do programa da Receita, precisa de engenharia reversa do layout), integração automática com corretora/B3, multi-carteira, dashboard customizável.

Me diga quais quer atacar e eu sigo o processo normal — uma pergunta de escopo por vez antes de codar.
