# Mapa de lógica e dados — App do Investidor

Referência técnica de como os dados fluem no app: entidades, relações,
regras de negócio e autenticação. Atualizar sempre que uma mudança alterar
schema, cálculo ou fluxo descrito aqui — este documento só tem valor se
continuar batendo com o código.

## 1. Visão geral do stack

- **Next.js 16** (App Router, TypeScript, Turbopack), diretório `src/`.
- **Supabase**: Postgres com RLS + Auth (email/senha e Google OAuth).
- **Vercel**: deploy automático a cada push em `main`.
- Sem API de cotação: preços são informados manualmente pelo usuário
  (`ativos.preco_atual`); gráfico embutido via TradingView (símbolo
  derivado ou definido manualmente).

## 2. Entidades e relações

```
auth.users (Supabase Auth)
  └─ profiles (1:1)                    dados pessoais + cadastro_completo
       ├─ investor_suitability (1:N)   histórico imutável do questionário
       │    └─ current_investor_suitability (view: última linha por perfil)
       ├─ alocacao_classes (1:N)       nível 1 da estrutura-alvo (ex. Ações)
       │    └─ alocacao_setores (1:N)  nível 2 (ex. Financeiro), FK classe_id
       ├─ ativos (1:N)                 registro mestre de cada investimento
       │    └─ setor_id → alocacao_setores (opcional; null = não classificado)
       │    (peso_alvo mora AQUI, não em uma tabela de "alocação de ativos")
       ├─ corretoras (1:N)              onde o ativo está custodiado
       ├─ transacoes (1:N)              compra/venda, FK ativo_id, corretora_id
       └─ proventos (1:N)               dividendo/JCP/rendimento, FK ativo_id
```

Todas as tabelas de domínio repetem `profile_id` (denormalizado) para RLS
simples e rápida (`auth.uid() = profile_id`), mesmo quando dá para chegar lá
via join — decisão deliberada, não duplicação acidental.

## 3. Fonte única de verdade (regra mais importante do app)

Cada informação existe em **um único lugar**. Nunca duplicar ao adicionar
funcionalidade nova:

| Informação | Mora em | Quem só lê (nunca escreve) |
|---|---|---|
| Classificação do ativo (setor + peso-alvo) | `ativos.setor_id`, `ativos.peso_alvo` | Alocação |
| Estrutura-alvo (classes/setores e seus pesos) | `alocacao_classes`, `alocacao_setores` | Ativos (só para popular o seletor) |
| Quantidade, preço médio, lucro realizado | Calculado em runtime a partir de `transacoes` (`lib/ativos/actions.ts#calcularPosicao`) | Carteira, Alocação |
| Valor atual de cada ativo | `quantidade × ativos.preco_atual` (mesmo cálculo acima) | Alocação, Configurações |
| Perfil de suitability vigente | `current_investor_suitability` (view) | Alocação (sugestão de template), Configurações (exibição) |
| Registro de proventos (dividendo/JCP/rendimento) | `lib/proventos` (tabela `proventos`) — único lugar com cadastrar/editar/excluir | Carteira (livro-razão combinado), detalhe do Ativo — ambos só leitura, sem botão de cadastrar/excluir |

Cadastro/edição/exclusão de provento só existe em `lib/proventos/actions.ts`
(aba Proventos). Carteira e a página do Ativo continuam consultando a
tabela `proventos` diretamente para exibir (leitura), mas nunca chamam
`criarProvento`/`excluirProvento` — isso é proposital: várias LEITURAS da
mesma fonte são incentivadas (redundância de informação), múltiplas
ESCRITAS da mesma fonte nunca são.

Se uma tela nova precisar de "posição do ativo" ou "estrutura de alocação",
ela **importa a função de `lib/ativos` ou `lib/alocacao`**, nunca reimplementa
o cálculo.

## 4. Fluxo de dados entre as abas

```
Carteira (compra/venda)             Alocação (estrutura-alvo)
  transacoes                          alocacao_classes + alocacao_setores
        │                                       │
        ▼                                       │
lib/ativos/actions.ts                            │
  calcularPosicao() → quantidade,                │
  precoMedio, lucroRealizado                     │
        │                                       │
        ▼                                       │
  obterAtivosComPosicao()  ── valorAtual ──▶  lib/alocacao/actions.ts
  (posição + valorAtual de cada ativo)          obterEstruturaAlocacao()
        │                                       monta árvore classe→setor→ativo
        │                                       calcula pesoReal e desvio em
        │                                       cada nível vs. o peso-alvo do
        ▼                                       nível pai imediato
   Aba Ativos (lista + detalhe)                       │
   Aba Carteira (livro-razão + nomes)                  ▼
                                              Aba Alocação (barras de desvio)

Proventos (dividendo/JCP/rendimento)
  lib/proventos/actions.ts — único lugar que cadastra/edita/exclui
        │
        ├──▶ Aba Carteira (livro-razão combinado, só leitura)
        └──▶ Aba Ativos [detalhe] (proventosRecebidos, retornoTotal, só leitura)
```

Pontos de atenção:
- **Carteira nunca escreve em `ativos`** além de referenciar `ativo_id`; quem
  cria/edita o registro mestre do ativo é a aba Ativos.
- **Alocação nunca cria nem edita ativo**; só lê `setor_id`/`peso_alvo` que a
  aba Ativos gravou.
- **Venda validada contra posição calculada**, não contra um campo de
  "quantidade em carteira" armazenado (`lib/carteira/actions.ts#criarTransacao`
  chama `obterAtivosComPosicao()` antes de aceitar uma venda).
- **Proventos só são cadastrados/editados/excluídos na aba Proventos**
  (`lib/proventos/actions.ts`). Carteira (`lib/carteira/actions.ts#obterLivroRazao`)
  e o detalhe do Ativo (`lib/ativos/actions.ts#obterAtivoDetalhe`) leem a
  tabela `proventos` direto, mas não têm mais botão de cadastrar/excluir —
  qualquer aba nova que precisar de dado de provento (ex. um futuro
  dashboard) deve ler de lá, nunca duplicar o cadastro.

## 5. Regras de negócio

### 5.1 Custo médio ponderado (posição do ativo)
`lib/ativos/actions.ts#calcularPosicao`. Padrão brasileiro (inclusive para IR
sobre renda variável):
- **Compra**: soma quantidade; recalcula preço médio proporcionalmente
  (`custoTotal / quantidade`).
- **Venda**: preço médio **não muda**; reduz quantidade e apura lucro
  realizado = `(preço_venda − preço_médio_atual) × qtd_vendida − custos`.
- Transações são ordenadas por `data` e depois por `created_at` antes do
  cálculo (`ordenarTransacoes`), então a ordem de lançamento não importa,
  só a data efetiva.

### 5.2 Desvio de alocação
Cada nível compara peso real com peso-alvo **relativo ao pai imediato**
(mesma lógica usada ao cadastrar as metas — cada nível soma 100% do nível
acima):
- Ativo: `% do valor do setor` vs. `ativos.peso_alvo`.
- Setor: `% do valor da classe` vs. `alocacao_setores.peso_alvo`.
- Classe: `% do patrimônio total investido` vs. `alocacao_classes.peso_alvo`.
- `desvio = pesoReal − pesoAlvo` (positivo = acima da meta, negativo = abaixo).
- Ativos sem `setor_id` (não classificados) ficam de fora da árvore de
  desvio, mas continuam contando na lista de Ativos e na Carteira.

### 5.3 Suitability (perfil de investidor)
`lib/suitability/score.ts`. Questionário gera um **score de 10 a 37** somando
pontos por resposta (objetivo, horizonte, liquidez, conhecimento,
experiência em 4 produtos, tolerância a perda, reação a perda). Faixas:
conservador (10–18), moderado (19–27), arrojado (28–37).
⚠️ Metodologia simplificada para MVP — antes de orientar decisões reais de
investimento, validar com compliance (CVM Resolução 30 exige metodologia
defensável e documentada). Cada preenchimento gera uma **linha nova** em
`investor_suitability` (histórico imutável, nunca UPDATE) — requisito de
rastreabilidade/compliance.

### 5.4 Proventos (dividendo/JCP/rendimento)
`lib/proventos/actions.ts#obterLivroProventos` calcula, a partir da mesma
lista de lançamentos, quatro visões: livro-razão cronológico, total geral,
total por tipo e total por ativo e por ano (agrupado por `data.slice(0,4)`).
Sem vínculo com corretora por enquanto (decisão consciente — proventos
guardam só `ativo_id`, `tipo`, `data`, `valor_total`; pode ganhar
`corretora_id` depois se precisar).
⚠️ Nota de negócio ainda não implementada: no Brasil, dividendo é isento de
IR para pessoa física, enquanto JCP tem retenção de 15% na fonte. Hoje o
app trata os dois genericamente como "provento" sem distinguir tributação —
considerar isso antes de qualquer cálculo futuro de IR devido.

### 5.5 Segurança (RLS)
Toda tabela de domínio tem Row Level Security com policy
`auth.uid() = profile_id` (ou `= id` em `profiles`). `investor_suitability`
não tem policy de UPDATE/DELETE de propósito — histórico é imutável mesmo
para o próprio dono da linha.

## 6. Fluxo de autenticação

1. **Cadastro** (`/cadastro`): `criarConta()` chama `supabase.auth.signUp`;
   trigger `handle_new_user` no banco cria a linha em `profiles`
   automaticamente. Etapa 2 (`salvarDadosPessoaisConfig`) exige sessão ativa.
2. **Login com Google** (login ou cadastro): `signInWithOAuth({provider:
   "google"})` → redireciona para o Google → Google volta para o callback
   fixo do Supabase (`https://<ref>.supabase.co/auth/v1/callback`) → Supabase
   redireciona para `/auth/callback?next=...` da nossa própria origem.
3. **`src/app/auth/callback/route.ts`**: troca o `code` por sessão
   (`exchangeCodeForSession`) e redireciona para `next` (padrão `/cadastro`
   no signup, `/dashboard` no login).
4. **`src/proxy.ts`** (roda em toda request, exceto assets estáticos):
   chama `updateSession()` (`lib/supabase/middleware.ts`), que renova o
   token via `supabase.auth.getUser()` e redireciona para `/login` se a rota
   é protegida (`/dashboard`, `/configuracoes`, `/alocacao`, `/carteira`,
   `/proventos`, `/indicadores`, `/imposto-renda`, `/ativos`,
   `/cadastro/perfil`) e não há usuário autenticado.
5. Três clientes Supabase distintos, cada um para seu contexto:
   `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (Server
   Components/Actions, via cookies do Next), `lib/supabase/middleware.ts`
   (usado só pelo proxy).

## 7. Estrutura de pastas

```
src/
  app/
    page.tsx                    landing (/)
    login/                      login email+senha e Google
    cadastro/                   signup + wizard de suitability (conta nova)
    esqueci-senha/, redefinir-senha/
    auth/callback/, auth/signout/
    (app)/                      grupo de rotas autenticadas (usa Sidebar)
      layout.tsx
      dashboard/
      ativos/                   lista + página de detalhe [id]
      carteira/                 livro-razão de compra/venda (+ proventos, só leitura) e gestão de corretoras
      proventos/                cadastro de dividendo/JCP/rendimento + consolidações
      indicadores/              Selic, IPCA, Dólar, Fluxo estrangeiro (dado compartilhado) + Visão Geral
      imposto-renda/            relatório de IR (mensal + resumo anual) por categoria de ativo
      alocacao/                 árvore de desvio (classe > setor > ativo)
      configuracoes/            dados pessoais, senha, suitability vigente, diretoria do Bacen, presidentes do Brasil, pesos do IPCA e metas de inflação (cadastros de referência)
  components/                   Sidebar, TradingViewChart, suitability/*
  lib/
    ativos/       actions.ts (motor de posição/desvio), schema.ts (Zod)
    alocacao/     actions.ts (estrutura-alvo), constants.ts, schema.ts
    carteira/     actions.ts (livro-razão de compra/venda), schema.ts
    proventos/    actions.ts (CRUD + consolidações), schema.ts
    indicadores/  actions.ts (CRUD + Visão Geral + motores Selic/IPCA), schema.ts, selic-estatisticas.ts, ipca-estatisticas.ts (cálculos puros, sem "use server" — usados no servidor e nos gráficos client-side)
    referencia/   actions.ts + schema.ts — CRUD de bacen_diretoria, brasil_presidentes, peso_ipca_grupo e meta_inflacao (sem profile_id), consumido por Configurações (cadastro) e por Indicadores/Selic/IPCA (filtros de mandato, pesos, metas)
    ir/           actions.ts (motor de apuração de IR por categoria, mensal + anual, só leitura da Carteira/Ativos)
    suitability/  actions.ts, schema.ts, score.ts
    supabase/     client.ts, server.ts, middleware.ts
  proxy.ts                      sessão + proteção de rotas (Next 16)
supabase/schema.sql              schema completo, comentado, idempotente
```

## 8. Roadmap — abas em estudo (ainda não implementadas)

Pesquisa feita em 2026-07-13 para embasar o design dessas duas abas antes de
construir qualquer uma. Nada abaixo está implementado — é a base de
conhecimento para as próximas decisões (ver histórico de conversa para as
perguntas de arquitetura ainda em aberto).

### 8.1 Imposto de Renda (relatório auxiliar de declaração)

⚠️ É um relatório **auxiliar**, não consultoria tributária — o app não
substitui um contador; qualquer número aqui deve ser conferido antes de
declarar. Regras vigentes (2026) por `ativos.tipo`:

- **`acao`/`fundo` (ações, ETFs, à vista)**: swing trade 15% sobre lucro
  líquido mensal, **isento se a soma das vendas do mês ≤ R$20.000** (isenção
  cai por completo se ultrapassar, não é só sobre o excedente). Day trade
  (compra e venda do mesmo ativo no mesmo dia) 20%, sem isenção. IRRF
  "dedo-duro" retido pela corretora (0,005% swing / 1% day trade) é só
  antecipação, abatida do DARF. Prejuízo compensa só dentro do mesmo grupo
  (swing com swing, day com day). DARF código 6015, até o último dia útil
  do mês seguinte. **O app não guarda hoje se uma transação foi day trade —
  precisa ser detectado (mesmo `ativo_id` com compra e venda na mesma
  `data`).**
- **`fii`**: rendimento mensal isento de IR (bolsa/balcão organizado, sócio
  com <10% das cotas). Venda de cota: **20% sobre qualquer ganho, sem
  isenção de piso** (diferente de ação).
- **`renda_fixa`**: tabela regressiva por prazo — até 180 dias 22,5%; 181–360
  dias 20%; 361–720 dias 17,5%; acima de 720 dias 15%. Retido na fonte
  automaticamente no resgate, sem DARF. **Exceção: LCI/LCA/CRI/CRA são
  isentos** — hoje o schema não distingue esses papéis isentos dos
  tributáveis (CDB/Tesouro/debênture) dentro do mesmo `tipo`.
- **`cripto`**: isento até R$35.000 de venda/mês em exchange nacional; acima
  disso 15–22,5% conforme faixa de ganho. Em exchange estrangeira, sem
  isenção mensal, 15% fixo sobre o lucro líquido anual. DARF código 4600.
- **`internacional`**: desde a Lei 14.754/2023, 15% fixo sobre ganho de
  capital (sem isenção de piso), apurado em GCAP + DARF; câmbio do dia da
  compra/venda entra no cálculo; prejuízo só compensa dentro do mesmo
  grupo/país.

### 8.2 Indicadores (Visão Geral + Selic, IPCA, Fluxo estrangeiro, Dólar)

**Achado mais importante**: o Banco Central publica o SGS (Sistema
Gerenciador de Séries Temporais), uma API pública e gratuita, sem
autenticação, com séries históricas prontas — `Selic meta` (série 432),
`Selic efetiva diária` (série 11), `IPCA` (série 433), `PTAX dólar` (série
1). Isso muda a arquitetura: diferente de `ativos.preco_atual` (sempre
manual), Selic/IPCA/Dólar **podem ser buscados automaticamente**, sem
cadastro manual do usuário.

- **Selic**: Copom se reúne 8x/ano, a cada ~45 dias, sempre em 2 dias
  consecutivos (decisão divulgada a partir das 18h do segundo dia).
  Calendário 2026 (datas já públicas): 17–18/mar, 28–29/abr, 16–17/jun,
  4–5/ago, 15–16/set, 3–4/nov, 8–9/dez. Taxa vigente em jul/2026: 14,25%
  a.a. (cortada na reunião de jun/2026). Presidente do BC: Gabriel
  Galípolo, mandato 2025–2028.
- **IPCA**: meta contínua desde 2025 (não é mais por ano-calendário; apurada
  sobre o acumulado de 12 meses). Centro da meta 3%, tolerância ±1,5 p.p.
  (banda 1,5%–4,5%). Projeção Focus jul/2026: ~5,16% para o ano — acima do
  teto (BC estima 79% de chance de estourar a meta). Abertura por
  categoria/grupo (alimentação, habitação, transportes etc.) vem do IBGE
  (SIDRA), API diferente da do BC.
- **Fluxo estrangeiro**: não achei uma API oficial gratuita e simples
  (dados publicados pela própria B3; agregadores como dadosdemercado.com.br
  republicam). Entrada de capital costuma ser lida como sinal de confiança;
  saída, como sinal de risco percebido — mas isoladamente não indica
  tendência estrutural. Precisa de mais investigação de fonte de dados
  antes de decidir automático vs. manual.
- **Dólar**: PTAX (SGS série 1) resolve o histórico. Fatores a considerar
  na análise: diferencial de juros Brasil x EUA, quadro fiscal, ciclo
  eleitoral 2026, preço de commodities (minério, petróleo, agro).

### 8.3 Decisões tomadas em 2026-07-13 (Indicadores)

Perguntas de arquitetura da aba Indicadores, já respondidas pelo Guilherme
— construção começa por Indicadores, IR fica para depois (perguntas de IR
seguem em aberto na seção 8.5):

1. **Ordem de construção**: Indicadores primeiro, Imposto de Renda depois.
2. **Fonte de dado**: cadastro manual para os quatro indicadores (Selic,
   IPCA, Dólar, Fluxo estrangeiro) — decidido não integrar a API do BACEN
   por enquanto, mesmo estando disponível e gratuita. Reavaliar essa escolha
   se o lançamento manual se mostrar trabalhoso demais na prática.
3. **Visão Geral**: mostra as duas coisas — painel-resumo objetivo (último
   valor + tendência de cada indicador, lado a lado) **e** uma leitura
   interpretativa combinada (texto explicando o que a combinação atual
   sugere, ex. juro alto + inflação acima da meta + dólar em alta = cenário
   de cautela).
4. **Fluxo estrangeiro**: lançamento mensal (saldo líquido em R$), não
   diário.
5. **Dólar**: lançamento mensal (não diário) — mesma cadência do fluxo
   estrangeiro e do IPCA.
6. **Calendário do Copom**: as datas de 2026 já públicas (17–18/mar,
   28–29/abr, 16–17/jun, 4–5/ago, 15–16/set, 3–4/nov, 8–9/dez) vêm
   **pré-cadastradas** no app (seed/migration). O usuário só lança a
   decisão (taxa definida) depois de cada reunião acontecer.
7. **Categorias do IPCA**: os 9 grupos oficiais do IBGE (alimentação e
   bebidas, habitação, artigos de residência, vestuário, transportes,
   saúde e cuidados pessoais, despesas pessoais, educação, comunicação) —
   não uma lista simplificada própria do app.
8. **Escopo dos dados**: Selic/IPCA/Dólar/Fluxo estrangeiro são dados
   oficiais, iguais para qualquer usuário — diferente do resto do app,
   essas tabelas **não têm `profile_id`** e não seguem RLS por usuário.
   Qualquer usuário autenticado lê e escreve o mesmo registro compartilhado
   (ver seção 8.4 para o desenho de schema). Isso é uma exceção deliberada
   à regra geral de RLS por `profile_id` — reavaliar se o app deixar de ser
   uso pessoal e virar multiusuário de verdade (hoje qualquer autenticado
   poderia editar o indicador de todo mundo).

### 8.4 Schema planejado para Indicadores (antes de codar)

Tabelas novas em `supabase/schema.sql`, todas **sem `profile_id`** (dado
compartilhado, ver 8.3.8):

- `indicador_selic_reunioes`: `id`, `data_inicio`, `data_fim` (reunião de 2
  dias), `taxa_definida` (nullable até a decisão sair), `decidido_em`
  (timestamp), `created_at`. Seed inicial com as 7 datas de 2026 já
  públicas, `taxa_definida = null` nas que ainda não aconteceram.
- `indicador_ipca_mensal`: `id`, `ano_mes` (ex. `2026-06`), `variacao_pct`
  (IPCA consolidado do mês), `acumulado_12m_pct`, `created_at`.
- `indicador_ipca_categoria`: `id`, `ano_mes`, `categoria` (enum com os 9
  grupos IBGE), `variacao_pct`, `created_at`. FK lógica em `ano_mes` para
  bater com `indicador_ipca_mensal` (não FK de banco, só convenção — mês
  pode ter só o consolidado lançado ainda sem detalhamento por categoria).
- `indicador_dolar_mensal`: `id`, `ano_mes`, `cotacao` (fechamento ou média
  do mês, a definir na UI), `created_at`.
- `indicador_fluxo_estrangeiro_mensal`: `id`, `ano_mes`, `saldo_liquido`
  (R$, pode ser negativo), `created_at`.

RLS: `USING (auth.role() = 'authenticated')` para SELECT/INSERT/UPDATE/DELETE
em todas — comentário no schema explicando a exceção (ver 8.3.8).

Módulo `lib/indicadores/` será o único lugar que cadastra/edita/exclui
esses quatro indicadores (mesma regra de fonte única de verdade da seção 3).
A sub-aba Visão Geral só lê os quatro conjuntos de dados, nunca escreve.

### 8.5 Decisões tomadas em 2026-07-13 (Imposto de Renda)

1. **Escopo**: cobrir todos os tipos de ativo de uma vez (ação/fundo, FII,
   renda fixa, cripto, internacional) — não faseado.
2. **Renda fixa isenta**: novo campo `ativos.subtipo_renda_fixa` (cdb,
   tesouro, debenture, lci, lca, cri, cra), preenchido no cadastro do ativo.
   `lci`/`lca`/`cri`/`cra` são isentos; os demais seguem a tabela regressiva.
3. **Cripto exchange**: novo campo `ativos.cripto_exchange` (nacional,
   estrangeira) — nacional tem isenção de R$35.000/mês em vendas;
   estrangeira não tem isenção, 15% fixo sobre o lucro anual.
4. **Câmbio de ativo internacional**: novo campo `transacoes.cambio`
   (nullable, só relevante quando `ativos.tipo = 'internacional'`) — o
   usuário informa o câmbio do dia ao lançar a compra/venda na Carteira.
5. **Formato do relatório**: detalhe mês a mês (lucro/prejuízo apurado,
   isenção aplicada, imposto devido, por categoria) **e** resumo anual
   consolidado no topo.

### 8.6 Motor de cálculo — desenho antes de codar

Day trade: mesmo `ativo_id` com compra E venda na mesma `data` — o volume
`min(qtd comprada no dia, qtd vendida no dia)` é tratado como day trade
(20%, sem isenção); o excedente da venda (se houver) é swing trade, usando o
preço médio ponderado que já vinha acumulado antes daquele dia. **Isso é uma
aproximação razoável, não um motor de casamento de ordens real** — documentar
esse limite na tela do relatório (é auxiliar, não substitui contador).

Prazo de renda fixa (pra tabela regressiva) não dá pra derivar do custo
médio ponderado (ele funde os lotes). Mantemos uma fila FIFO auxiliar *só*
para renda fixa, em paralelo ao cálculo de custo médio — consome lotes mais
antigos primeiro pra saber quantos dias aquela venda específica ficou
aplicada, sem alterar o cálculo de ganho (que continua usando custo médio,
igual ao resto do app).

Cálculo é sempre reaproveitando a mesma passada cronológica por transação já
usada em `lib/ativos/actions.ts#calcularPosicao` (fonte única de verdade,
seção 3) — o módulo `lib/ir` não reimplementa o algoritmo de custo médio, só
estende a mesma passada para também emitir o detalhe de cada venda (data,
ganho, se foi day trade).

### 8.7 Decisões tomadas em 2026-07-14 (Selic avançada + cadastros de referência)

Guilherme trouxe uma especificação detalhada (recebida de fonte externa) para
reformular a sub-aba **Selic** dentro de Indicadores. Decisões de escopo já
confirmadas antes de codar:

1. **Escopo**: implementar a especificação inteira de uma vez (cards,
   Banco Central, gráfico, histórico, importação) — não faseado.
2. **Entrada de dados**: os dois modelos convivem. O lançamento manual linha
   a linha (botão "Lançar decisão" já existente, um registro por vez) continua
   existindo — útil pro dia a dia, já que só sai 1 reunião nova a cada ~45
   dias. A importação em massa (colar texto no formato `REUNIÃO / DATA /
   SELIC`) é um caminho adicional, pensado pra carregar/corrigir histórico
   grande de uma vez (ex. anos de dados colados do Excel ou de um site
   oficial). Nenhum dos dois é removido.
3. **Diretoria do Banco Central**: em vez de simplificar pra só "presidente
   vigente" (que é o que já existe hoje, hardcoded em `obterSelic()`), o
   Guilherme quer a diretoria completa (presidente + diretores, todos os
   mandatos históricos) cadastrável de verdade. Esse cadastro **não vive
   dentro da aba Indicadores** — vive em **duas novas sub-abas dentro de
   Configurações**:
   - **Configurações → Diretoria do Bacen**: CRUD de `bacen_diretoria`
     (nome, cargo, início/fim de mandato, nomeado por, data de posse).
   - **Configurações → Presidentes do Brasil**: CRUD de `brasil_presidentes`
     (nome, início/fim de mandato).
   Motivo de ficar em Configurações: é dado de referência/cadastro
   administrativo, não um lançamento periódico como Selic/IPCA — e o
   Guilherme foi explícito que essas duas listas **vão alimentar mais de uma
   aba** (Selic agora, IPCA depois — os filtros "mandato do presidente do
   BC" e "mandato presidencial" do gráfico de evolução).
4. **Arquitetura de dado compartilhado**: `bacen_diretoria` e
   `brasil_presidentes` seguem exatamente o mesmo padrão já estabelecido pra
   Indicadores (seção 8.3.8) — **sem `profile_id`**, RLS
   `auth.role() = 'authenticated'` pra todo CRUD. É dado histórico/público,
   igual pra qualquer usuário do app, não dado pessoal.
5. **Dados derivados nunca são armazenados** (reforça o princípio já usado
   em Indicadores/IR): taxa vigente, última decisão, direção, sequência de
   decisões consecutivas, tempo da taxa atual, variação, tendência,
   estatísticas (máx/mín/média/mediana/desvio padrão/amplitude, contagens de
   altas/reduções/manutenções, maior alta, maior redução, tempo médio entre
   reuniões, tempo médio de vigência) e média móvel são **sempre recalculados
   em `lib/indicadores/actions.ts`** a partir de `indicador_selic_reunioes`,
   nunca gravados em coluna. Qualquer edição/exclusão/importação recalcula
   tudo automaticamente porque nada fica "desatualizado" em cache.
6. **Numeração oficial da reunião** ("277ª reunião"): não dá pra derivar só
   contando linhas (a numeração oficial do Copom começa em 1996 e o app pode
   não ter o histórico completo carregado). Por isso ganha campo próprio
   `numero_reuniao` (nullable, preenchido via importação ou manualmente) em
   vez de ser calculado.

#### Schema planejado (seção 8.7)

- `indicador_selic_reunioes` (tabela já existe — só ganha coluna nova):
  `alter table ... add column if not exists numero_reuniao integer` (unique
  quando não nulo). Segue sem `profile_id` (já documentado em 8.3/8.4).
- `bacen_diretoria` (nova, sem `profile_id`): `id`, `nome`, `cargo` (texto
  livre — cargo/diretoria do Bacen mudou de nome várias vezes ao longo das
  décadas, não vale a pena travar num enum fixo), **`presidente` (boolean,
  default false)** — flag separada do texto livre de `cargo` pra saber com
  certeza qual linha é presidência (usado pro card "Presidente do BC" e pro
  filtro de mandato presidencial do BC no gráfico, sem precisar parsear
  `cargo`), `mandato_inicio` (date), `mandato_fim` (date, nullable = mandato
  vigente), `nomeado_por` (texto, nullable), `data_posse` (date, nullable).
- `brasil_presidentes` (nova, sem `profile_id`): `id`, `nome`,
  `mandato_inicio` (date), `mandato_fim` (date, nullable = mandato vigente).

RLS: mesmo padrão `auth.role() = 'authenticated'` das outras tabelas de
Indicadores (ver 8.3.8 pro racional da exceção à regra geral de
`profile_id`).

#### Importação (parser) — desenho antes de codar

Cola de texto multi-linha, colunas separadas por TAB ou por 2+ espaços.
Cada linha vira um upsert em `indicador_selic_reunioes` **por `data_inicio`**
(já é `unique` na tabela): se a data já existe, atualiza `numero_reuniao` e
`taxa_definida`; se não existe, insere uma reunião nova com
`decidido_em = now()`. `data_fim` (reunião de 2 dias) não vem no texto colado
— assumimos `data_fim = data_inicio + 1 dia` quando a importação cria uma
reunião nova (ajustável manualmente depois, como qualquer outro registro).
Validação antes de gravar: número de reunião e data não podem se repetir
dentro do lote colado, Selic não pode ser negativa, datas não podem ser
futuras. Depois do upsert, todo o recálculo de decisão/variação/sequência
acontece na leitura (`obterSelic()`), não em cima do dado gravado — não tem
"recalcular e salvar", é sempre "recalcular ao exibir" (ver decisão 5).

#### Gráfico — sem nova dependência

O app não tem nenhuma lib de gráficos (o `TradingViewChart` é um embed de
iframe externo, não uma lib npm). Pra evitar dependência nova (risco de
instalação falhar neste sandbox por falta de rede, ver seção 3) o gráfico de
evolução da Selic é **SVG artesanal** (componente próprio), não
recharts/chart.js/etc. "Zoom" do pedido original vira, na prática, o filtro
de período (todo histórico / 12m / 24m / 5 anos / 10 anos / personalizado
com datas) — sem arrastar-para-selecionar no canvas. Média móvel (3/5/8/12
reuniões ou personalizado) é calculada em `lib/indicadores/selic-estatisticas.ts`
(módulo comum, sem `"use server"`, importável tanto pela action quanto
direto pelo componente de gráfico no cliente).

#### Fora de escopo por enquanto

- **IPCA reutilizar os mesmos filtros de mandato**: os cadastros de
  `bacen_diretoria`/`brasil_presidentes` já nascem prontos pra isso, mas a
  integração no gráfico de IPCA fica pra quando essa sub-aba for trabalhada
  (Guilherme pediu Selic primeiro).
- **Preenchimento histórico dos cadastros** (quem foi presidente do Bacen em
  1999, etc.): a tela fica pronta pra cadastro, mas o preenchimento dos
  dados históricos é manual pelo Guilherme (ou por um pedido futuro
  explícito pra eu pesquisar e sugerir os valores) — não estou assumindo os
  nomes/datas sem confirmação.

### 8.8 Decisões tomadas em 2026-07-14 (IPCA avançado + Pesos/Metas)

Guilherme trouxe uma especificação detalhada pra reformular a sub-aba
**IPCA** dentro de Indicadores, no mesmo espírito da Selic. Decisões de
escopo confirmadas antes de codar:

1. **Escopo**: implementar a especificação inteira de uma vez (cards,
   gráfico com múltiplos tipos + heatmap, histórico, importação, Pesos e
   Metas em Configurações) — não faseado, mesmo padrão de IR/Selic.
2. **Impacto por grupo**: sempre calculado (`peso vigente × variação do
   grupo`, metodologia oficial do IBGE), nunca armazenado nem
   sobrescrevível manualmente. Reforça o princípio já usado em Selic/IR de
   nunca guardar o que pode ser derivado — descartamos o campo de "impacto
   oficial informado na importação + divergência" que o documento original
   sugeria, pra manter schema e importação mais simples.
3. **Redesenho de schema — tabela única**: o IPCA hoje vive em duas tabelas
   (`indicador_ipca_mensal` só com o geral, `indicador_ipca_categoria` com
   um lançamento por grupo). Isso não bate com o formato de importação
   (uma linha por competência, geral + 9 grupos juntos) nem com o Bloco 3
   (editar/duplicar/excluir uma competência inteira de uma vez). Redesenho:
   `indicador_ipca_mensal` ganha as 9 colunas de grupo direto (mesmo padrão
   de tabela larga usado em `indicador_selic_reunioes`); `indicador_ipca_categoria`
   é migrada e aposentada (`drop table` depois de copiar os dados).
4. **Acumulado no ano / 12 meses**: sempre calculado por juros compostos
   (`((1+i1)×(1+i2)×...×(1+in))−1`) a partir das variações mensais já
   armazenadas — nunca coluna própria (o schema antigo tinha
   `acumulado_12m_pct` como campo editável manualmente; isso é removido).
   Se o histórico carregado tiver menos de 12 meses, o acumulado 12m é
   calculado sobre os meses disponíveis e a tela sinaliza que não é um
   12 meses completo.
5. **Pesos do IPCA** (`Configurações → Pesos do IPCA`): cadastro por grupo
   com vigência (`peso_ipca_grupo`) — dado compartilhado, sem `profile_id`,
   mesmo padrão de `bacen_diretoria`. Durante qualquer cálculo de impacto,
   o sistema busca o peso vigente pra competência analisada (vigência que
   cobre aquele mês).
6. **Metas de Inflação** (`Configurações → Metas de Inflação`): cadastro
   com vigência (`meta_inflacao`) — `meta_central`, `banda_inferior`,
   `banda_superior` explícitos (não assumimos tolerância simétrica, mesmo
   o Brasil historicamente usando banda simétrica — mais flexível e não
   força suposição). Mesmo padrão de dado compartilhado sem `profile_id`.
   Substitui as constantes hardcoded `META_IPCA_CENTRO`/`META_IPCA_TOLERANCIA`
   que existiam antes.
7. **Precisão**: percentuais armazenados com 4 casas decimais internamente
   (`numeric(8,4)`), exibidos com 2 casas na UI — conforme pedido.

#### Schema planejado (seção 8.8)

- `indicador_ipca_mensal` (redesenhada — tabela já existe, ganha colunas
  novas e perde `acumulado_12m_pct`): `id`, `ano_mes` (unique), `geral`
  (variação do índice geral, numeric 8,4), `alimentacao_bebidas`,
  `habitacao`, `artigos_residencia`, `vestuario`, `transportes`,
  `saude_cuidados_pessoais`, `despesas_pessoais`, `educacao`,
  `comunicacao` (variação de cada grupo, numeric 8,4, nullable — pode
  faltar detalhamento por grupo mesmo com o geral lançado), `data_divulgacao`
  (date, nullable), `fonte` (text, default `'IBGE'`), `observacoes` (text,
  nullable).
- `peso_ipca_grupo` (nova, sem `profile_id`): `id`, `grupo` (mesmo enum dos
  9 grupos), `peso_pct` (numeric 6,4), `vigencia_inicio` (date),
  `vigencia_fim` (date, nullable = vigente), `metodologia` (text, ex.
  "POF 2017/2018").
- `meta_inflacao` (nova, sem `profile_id`): `id`, `meta_central` (numeric
  5,2), `banda_inferior` (numeric 5,2), `banda_superior` (numeric 5,2),
  `vigencia_inicio` (date), `vigencia_fim` (date, nullable = vigente).

RLS: mesmo padrão `auth.role() = 'authenticated'` das outras tabelas de
Indicadores/Referência.

#### Migração de dado existente

`indicador_ipca_categoria` tem lançamentos reais possivelmente já feitos
pelo Guilherme. A migração (dentro do próprio `schema.sql`, idempotente)
copia cada linha de categoria pra coluna correspondente em
`indicador_ipca_mensal` (fazendo upsert por `ano_mes` — cria a linha em
`indicador_ipca_mensal` se só existir a categoria e não o geral ainda) e só
então dropa `indicador_ipca_categoria`.

#### Fora de escopo por enquanto

- **Subgrupos/Itens/Subitens** do IPCA (nível 3+ da estrutura oficial do
  IBGE): schema fica em nível 2 (grupo) só, mas o desenho não impede
  adicionar uma tabela `indicador_ipca_subgrupo` depois sem quebrar nada
  (mesmo princípio do documento original).
- **Integração com CDI/Tesouro IPCA+/juro real da Carteira**: os cálculos
  ficam prontos pra alimentar isso (acumulado 12m já é a base do juro
  real), mas a integração de fato só acontece quando essas outras abas
  forem trabalhadas.

## 9. Convenções a preservar

- Toda action em arquivo `"use server"` precisa ser **async** mesmo que não
  faça `await` (Next exige; funções auxiliares internas não-exportadas ficam
  de fora dessa regra).
- Validação de formulário com Zod em `schema.ts` ao lado de cada `actions.ts`.
- Nomes de campos/variáveis em português (`ticker`, `peso_alvo`,
  `valorAtual`), consistente em banco, actions e UI — não misturar idiomas
  em nomes novos.
- Preço é sempre informado manualmente (não há integração de cotação);
  qualquer feature que assuma preço "ao vivo" precisa checar
  `preco_atualizado_em` antes de confiar no valor.
