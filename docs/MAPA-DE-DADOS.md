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
    indicadores/  actions.ts (CRUD + Visão Geral + motores Selic/IPCA/Dólar), schema.ts, selic-estatisticas.ts, ipca-estatisticas.ts, dolar-estatisticas.ts (cálculos puros, sem "use server" — usados no servidor e nos gráficos client-side)
    referencia/   actions.ts + schema.ts — CRUD de bacen_diretoria, brasil_presidentes, peso_ipca_grupo e meta_inflacao (sem profile_id), consumido por Configurações (cadastro) e por Indicadores/Selic/IPCA (filtros de mandato, pesos, metas)
    ir/           actions.ts (motor de apuração de IR por categoria, mensal + anual, só leitura da Carteira/Ativos)
    suitability/  actions.ts, schema.ts, score.ts
    supabase/     client.ts, server.ts, middleware.ts, admin.ts (service role, só para rotas de cron)
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
   se o lançamento manual se mostrar trabalhoso demais na prática. **Ver
   8.9 decisão 2 — essa escolha foi revista especificamente pro Dólar.**
3. **Visão Geral**: mostra as duas coisas — painel-resumo objetivo (último
   valor + tendência de cada indicador, lado a lado) **e** uma leitura
   interpretativa combinada (texto explicando o que a combinação atual
   sugere, ex. juro alto + inflação acima da meta + dólar em alta = cenário
   de cautela).
4. **Fluxo estrangeiro**: lançamento mensal (saldo líquido em R$), não
   diário.
5. **Dólar**: lançamento mensal (não diário) — mesma cadência do fluxo
   estrangeiro e do IPCA. **Superado pela decisão 8.9.1 (granularidade
   diária).**
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

### 8.9 Decisões tomadas em 2026-07-14 (Dólar avançado + automação)

Guilherme trouxe uma análise detalhada (recebida de fonte externa, com um
raciocínio de economista/gestor de patrimônio) sobre o papel do Dólar
(USD/BRL) na economia brasileira e o que a sub-aba **Dólar** dentro de
Indicadores precisaria ter pra refletir isso: cotação e histórico,
tendência e estatísticas, volatilidade e ciclos, e relações com Selic/IPCA.
Decisões de escopo confirmadas antes de codar:

1. **Granularidade muda de mensal pra diária.** Hoje o Dólar é lançado uma
   vez por mês (mesma cadência do Fluxo estrangeiro). O Dólar é um ativo
   financeiro negociado todo dia útil — médias móveis de mercado (5/20/50/
   100/200 dias, como pedido) só fazem sentido sobre uma série diária.
   `indicador_dolar_mensal` é substituída por `indicador_dolar_diario`
   (data + cotação, sem abertura/máxima/mínima — o resto pode ser
   calculado/adicionado depois se algum dia fizer falta).
2. **Automação via API do Bacen (reabre parcialmente a decisão 8.3.2).** A
   decisão de 2026-07-13 foi "cadastro manual pros quatro indicadores,
   sem integrar a API do Bacen por enquanto". Isso muda **só pro Dólar**:
   o Bacen expõe a PTAX de fechamento diária publicamente via API SGS
   (Sistema Gerenciador de Séries Temporais), sem autenticação. Um Vercel
   Cron Job roda uma rota de API uma vez por dia (depois do fechamento da
   PTAX, ~13h) e faz upsert da cotação do dia em `indicador_dolar_diario`.
   Selic, IPCA e Fluxo estrangeiro **continuam manuais** — não têm uma API
   pública tão simples e estável quanto a PTAX, e dependem de decisão do
   COPOM / divulgação do IBGE / B3, não de um valor diário objetivo.
3. **Backfill histórico desde 1999** (início do regime de câmbio
   flutuante no Brasil). A mesma rota de cron que faz a atualização diária
   também faz o backfill: se a tabela estiver vazia (ou tiver buraco desde
   o último dia salvo), busca da API do Bacen tudo entre a última data
   salva (ou 1999-01-04 se a tabela estiver vazia) e hoje, em janelas de
   até 10 anos por chamada (limite prático da API do Bacen pra intervalos
   grandes), e faz upsert em lote. Isso significa que a mesma rota serve
   tanto pro backfill inicial quanto pra atualização incremental diária —
   não existe um script de migração à parte.
4. **Aba somente-leitura.** Sem cadastro manual, edição ou importação por
   colar texto pro Dólar — o único jeito de um valor mudar é o cron rodar
   de novo (correção pontual, se necessário, é direto no banco ou
   re-executando o cron pro intervalo afetado). É uma exceção ao padrão
   Selic/IPCA (que mantêm lançamento manual + importação como fallback)
   porque a fonte automática é confiável e pública — manter um formulário
   de cadastro que compete com o cron adicionaria risco de inconsistência
   sem benefício real.
5. **Relações Macroeconômicas — só Dólar × Selic e Dólar × IPCA por
   enquanto.** A análise original pedia também Dólar × CDI, mas o CDI não
   existe em nenhum lugar do app hoje (nenhuma tabela, schema ou tela) —
   criá-lo do zero é do tamanho de um indicador novo (histórico diário,
   também automatizável via Bacen SGS). Fica documentado como candidato a
   próximo indicador; quando existir, a comparação com Dólar entra junto.
6. **Método de comparação: correlação estatística (Pearson), não só
   gráfico sobreposto.** Mesmo padrão já usado no motor do IPCA
   (`correlacaoGrupoComGeral`): o Dólar diário é reamostrado pra mensal
   (fechamento do mês = cotação do último dia útil disponível naquele
   mês) e a correlação é calculada entre a variação mensal do Dólar e (a)
   a variação mensal do IPCA geral, (b) a Selic vigente no fim de cada
   mês. Amostra mínima de 3 pontos pareados, mesma regra do IPCA.
7. **Dados derivados nunca são armazenados** (mesmo princípio de
   Selic/IPCA): variação diária/mensal/anual, máxima/mínima histórica,
   média e desvio padrão históricos, médias móveis, tendência, sequência
   de dias consecutivos de alta/queda, volatilidade atual vs histórica e
   as correlações com Selic/IPCA são **sempre recalculados** em
   `lib/indicadores/dolar-estatisticas.ts` + `actions.ts` a partir de
   `indicador_dolar_diario` (e das séries de Selic/IPCA já existentes),
   nunca gravados em coluna.

#### Schema planejado (seção 8.9)

- `indicador_dolar_diario` (nova, sem `profile_id`, mesmo padrão de dado
  compartilhado das outras tabelas de Indicadores): `id`, `data` (date,
  unique), `cotacao` (numeric(10,4), > 0), `created_at`, `updated_at`.
- `indicador_dolar_mensal` (antiga): dropada. O backfill desde 1999 deixa
  qualquer lançamento mensal manual anterior estritamente obsoleto (dado
  real da PTAX é superior a uma aproximação mensal digitada à mão), então
  não há migração de dado — só `drop table`.

RLS: habilitado, mas **diferente do padrão usado até aqui**. Como a aba é
somente-leitura pro usuário, a policy cobre só `select` pra
`auth.role() = 'authenticated'` — não existe policy de `insert`/`update`/
`delete` pra esse papel. A escrita (cron) usa a **service role key**
(`SUPABASE_SERVICE_ROLE_KEY`), que bypassa RLS por padrão no Supabase —
não precisa de policy própria pra isso.

#### Automação — cron + API do Bacen (desenho antes de codar)

- **Fonte**: API SGS do Bacen, série 1 (dólar americano venda, PTAX
  fechamento) — `https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados`,
  JSON público, parâmetros `dataInicial`/`dataFinal` no formato
  `DD/MM/AAAA`. Sem necessidade de chave.
- **Rota**: `src/app/api/cron/dolar/route.ts` (Route Handler, não Server
  Action — cron do Vercel chama via HTTP, não tem sessão de usuário).
  Protegida por um segredo (`CRON_SECRET`) comparado no header
  `Authorization: Bearer` (é como a própria documentação da Vercel
  recomenda proteger cron routes) — não é uma credencial do usuário, é um
  segredo da aplicação gerado uma vez e configurado nas env vars da
  Vercel.
- **Cliente**: novo `src/lib/supabase/admin.ts`, usando
  `SUPABASE_SERVICE_ROLE_KEY` (só no servidor, nunca exposto ao
  navegador) — os três clients existentes (`client.ts`/`server.ts`/
  `middleware.ts`) dependem de sessão de usuário via cookies, o que não
  existe numa chamada de cron.
- **Agendamento**: `vercel.json` com um cron diário (`0 21 * * *` UTC =
  18h em Brasília, seguro depois do fechamento da PTAX). Feriados/fins de
  semana: o Bacen não publica valor novo, a rota simplesmente não
  encontra dado pro intervalo e não faz nada — sem erro.
- **Idempotência**: upsert por `data` (unique) — rodar o cron mais de uma
  vez pro mesmo dia não duplica nem corrompe nada.

#### Motor de cálculo — desenho antes de codar

- **Tendência**: comparação de médias móveis curta × longa sobre a
  cotação (mesmo espírito do MM3×MM6 do IPCA), usando MM20 × MM200
  (curto prazo de mercado vs. tendência de longo prazo, referência comum
  no mercado financeiro) — cotação e MM20 acima da MM200 = alta; abaixo
  das duas = baixa; caso misto = lateral.
- **Volatilidade**: desvio padrão da série de variações percentuais
  diárias (não da cotação em nível) — "volatilidade atual" sobre os
  últimos 30 dias úteis com dado, "volatilidade histórica" sobre toda a
  série. Comparar as duas responde "está mais ou menos arriscado que o
  normal".
- **Sequência de dias consecutivos**: mesmo algoritmo do
  `calcularSequenciaAceleracaoDesaceleracao` do IPCA, aplicado à direção
  dia a dia da cotação.
- **Correlação com Selic/IPCA**: reaproveita `correlacaoPearson` (já
  genérica, vive em `ipca-estatisticas.ts`) — `dolar-estatisticas.ts`
  importa a função em vez de duplicar a fórmula.

#### Fora de escopo por enquanto

- **CDI como indicador** (e a comparação Dólar × CDI): candidato a
  próxima sub-aba de Indicadores, do tamanho de um indicador novo
  completo (tabela diária, automação via Bacen SGS, motor de cálculo).
- **OHLC (abertura/máxima/mínima intradiária)**: só a cotação de
  fechamento é armazenada por enquanto; o schema não impede adicionar
  essas colunas depois sem quebrar nada.
- **Automatizar Selic/IPCA/Fluxo estrangeiro do mesmo jeito**: essa
  sessão trata só do Dólar; os outros três indicadores continuam
  manuais (ver decisão 2 acima).

### 8.10 Decisões tomadas em 2026-07-14 (Ativo avançado: cotação automática, checklist comparativo e resultados trimestrais)

Pedido original: a página de cada Ativo deveria puxar a cotação atual
automaticamente, ganhar uma sub-aba de monitoramento de resultados
trimestrais das empresas, e um checklist comparativo — um template pra
Ações/ETFs/ações internacionais (P/L, PEG Ratio, P/VP, ROE, ROA, ROIC,
margens, endividamento, crescimento, governança) e outro pra FIIs (P/VP,
liquidez, vacância, cap rate, dividend yield, valor m²/aluguel), nos moldes
de dois checklists impressos enviados como referência. As decisões abaixo
resolvem as ambiguidades levantadas antes de codar.

1. **Fonte de dados**: Yahoo Finance (endpoint não-oficial, gratuito, sem
   chave) para cotação atual e histórico de preço. Decisão explícita de
   **não** assinar brapi.dev por ora (planos pagos, a partir de ~R$100/mês,
   seriam necessários pra automação completa de fundamentos e FIIs
   detalhados) — o resto do checklist e os resultados trimestrais ficam
   com lançamento manual. Trade-off aceito: o endpoint do Yahoo é instável
   (pode mudar/bloquear sem aviso, atraso de 15-20min) — qualquer rotina
   que o use precisa tolerar falha sem quebrar o resto da tela.
2. **Cotação automática — gatilho duplo**: cron diário (mesmo padrão do
   Dólar, `src/app/api/cron/*`) atualiza a cotação de todos os ativos
   cotáveis de uma vez, **e** um botão manual "Atualizar agora" na página
   do ativo busca na hora, pro usuário não depender só do horário do cron.
3. **Novo tipo de ativo `etf`**: o enum de `tipo` não tinha categoria
   própria pra ETF listado na B3 (BOVA11, IVVB11 etc.) — só existia
   `internacional` ("ação/ETF exterior"). Adicionado `etf` ao enum. O
   checklist "Ações" vale para `acao` + `etf` + `internacional` (o pedido
   original agrupa "ações, ETF e stock" no mesmo template), com a ressalva
   de que várias métricas (P/L, ROE etc.) não fazem sentido conceitual
   pra ETF puro — ficam em branco/"—" nesse caso, sem impedir o
   preenchimento de quem quiser usar mesmo assim.
4. **Tipos com cotação automática**: `acao`, `fii`, `etf`, `internacional`,
   `cripto` — todos têm um símbolo de mercado líquido derivável do ticker
   (`TICKER.SA` pra B3, `TICKER-USD` pra cripto, ticker puro pra
   internacional). `renda_fixa`, `fundo` e `outro` continuam 100%
   manuais (CDB/Tesouro/fundo fechado não têm cotação de mercado líquida
   comparável via Yahoo) — isso **substitui parcialmente** a convenção
   antiga da seção 9 ("preço é sempre informado manualmente"), que passa a
   valer só pra esses três tipos.
5. **Checklist comparativo**: vive em duas partes — (a) uma seção na
   própria página do ativo, preenchida individualmente; (b) uma tela nova
   de comparação lado a lado (2-3 ativos do mesmo grupo — ações/ETF entre
   si, ou FIIs entre si —, colunas A/B/C, igual aos templates enviados).
   Os dois lêem a mesma fonte de dados (nunca duplicada).
6. **Resultados trimestrais — dados brutos, nunca os índices prontos**:
   nova tabela por ativo com os números BRUTOS de cada trimestre
   (receita, lucro, patrimônio líquido, dívida etc. pra ações/ETF/
   internacional; distribuição, vacância, valor patrimonial da cota etc.
   pra FIIs) lançados manualmente. Os índices do checklist que dependem de
   demonstração financeira (P/L, ROE, ROIC, margens, DL/EBIT, CAGR...) são
   **sempre recalculados** a partir dessa tabela + preço atual — nunca
   ficam guardados soltos, mesma regra de ouro do resto do app (seção 3).
7. **Nuances de fórmula resolvidas** (documentando pra não perder o
   raciocínio depois):
   - **ROIC**: usa NOPAT aproximado = EBIT × (1 − 34%), a alíquota
     efetiva padrão de IRPJ+CSLL no Brasil pra empresas no lucro real
     (aproximação comum em plataformas de análise fundamentalista, não é
     o imposto de caixa exato da empresa). Capital investido = dívida
     líquida + patrimônio líquido (último trimestre).
   - **"DL/EBIT" do card de Ações**: o template impresso tem um conflito —
     a célula da tabela diz "DL/EBIT" mas a fórmula no rodapé diz
     "Dív. Bruta/EBITDA". A fórmula do rodapé é quem manda: o card
     calcula e rotula como **Dívida Bruta/EBITDA** (índice de alavancagem
     padrão), não dívida líquida sobre EBIT.
   - **"Saldo dos Acionistas"** (linha de Governança do template de
     Ações): não tem fórmula no rodapé do checklist — não é um índice
     computável a partir de demonstração financeira. Vira campo de texto
     livre, manual, **por ativo** (não por trimestre) — ex.: estrutura de
     controle, free float, notas de governança.
   - **CAGR EBIT / CAGR Lucro (5 anos)**: comparam o trimestre mais
     recente com o mesmo trimestre 5 anos atrás (20 trimestres de
     distância) — enquanto não houver histórico manual suficiente
     lançado, o card mostra "—" em vez de calcular com janela incompleta.
   - **PEG Ratio**: P/L ÷ crescimento do LPA (lucro por ação) — usa a
     variação percentual do LPA dos últimos 12 meses (TTM) contra o TTM
     do ano anterior.
   - Todos os índices "TTM" (P/L, PEG, Mg. Bruta, Mg. Lucro, ROE, ROA,
     ROIC) somam os 4 trimestres mais recentes lançados; card mostra "—"
     com menos de 4 trimestres.
8. **Dividend Yield do FII é a única métrica do checklist FII que NÃO
   precisa de lançamento novo**: reaproveita a tabela `proventos` que já
   existe (soma dos últimos 12 meses ÷ preço atual da cota) — segue a
   regra de fonte única, sem duplicar proventos numa tabela nova.
9. **`cotacao_automatica` é sempre derivado do `tipo`, nunca um toggle
   manual independente**: `criarAtivo`/`editarAtivo`
   (`lib/ativos/actions.ts`) recalculam esse campo a cada save a partir de
   `TIPOS_COTACAO_AUTOMATICA` (decisão 4) — criar um ativo `acao` já liga
   automático sem precisar de passo extra, e trocar o tipo do ativo depois
   (ex.: de `renda_fixa` pra `acao`) liga/desliga junto. Não existe hoje
   um botão "desligar cotação automática nesse ativo específico" — se
   surgir a necessidade (ex.: ticker delistado que o Yahoo não acha mais),
   isso é uma decisão nova a levantar, não algo pra assumir agora.
10. **UI final**: a página `/ativos/[id]` ganhou sub-abas "Visão geral"
    (gráfico, classificação, posição — com botão "Atualizar agora" e a
    fonte do preço —, checklist do grupo do ativo, transações, proventos)
    e "Resultados trimestrais" (lançamento manual + série histórica com
    variação QoQ/YoY da métrica-âncora de cada grupo — Lucro Líquido pra
    ações, Receita Imobiliária pra FIIs). As sub-abas só aparecem pra
    ativos com `grupo` definido (`acao`/`etf`/`internacional` ou `fii`);
    `renda_fixa`/`fundo`/`outro`/`cripto` continuam com a página antiga,
    sem checklist (cripto tem cotação automática mas não tem template de
    checklist). Nova rota `/ativos/comparar?grupo=acoes|fiis`
    (`ComparativoView.tsx`) deixa escolher até 3 ativos do mesmo grupo e
    ver o checklist lado a lado, lendo os mesmos dados de
    `obterChecklistAtivo`/`obterChecklistsPorGrupo` (nunca duplica cálculo).
11. **Painel de monitoramento (2026-07-14)**: dentro da sub-aba "Resultados
    trimestrais", abaixo da tabela histórica, um "Painel de monitoramento"
    (`PainelMonitoramento` em `AtivoDetalheView.tsx`) mostra, pro mesmo
    ativo (nunca cross-ativo — ver decisão 6 e a distinção com a tela
    `/ativos/comparar`, que é cross-ativo mas só compara os índices atuais,
    nunca a série histórica):
    - **Gráficos de evolução**: as mesmas métricas do checklist comparativo
      (decisão do usuário: "as mesmas do checklist"), mas só as que
      **não dependem do preço atual** — ROE, ROA, ROIC, Mg. Bruta,
      Mg. Lucro, DL/PL, Dívida Bruta/EBITDA, Liq. Corrente (Ações/ETF);
      Cap Rate, Vacância Financeira, Vacância Física, Nº Negócios/mês
      (FIIs). P/L, P/VP, PEG Ratio e Dividend Yield ficam de fora do
      gráfico histórico (decisão do usuário) porque só temos o preço de
      HOJE, não o de cada trimestre passado — aplicar o preço atual
      retroativamente distorceria a série; continuam disponíveis como
      valor atual único na seção Checklist já existente. Implementado como
      SVG hand-rolled (`MiniLineChart`, sem lib de gráfico — segue o
      padrão sem-dependência de `components/DesvioBar.tsx`), calculado via
      `calcularSerieChecklistAcao`/`Fii` em `checklist-estatisticas.ts`:
      chama `calcularChecklistAcao`/`Fii` repetidamente com uma janela de
      trimestres encolhendo (do mais recente pra trás) e `precoAtual: null`
      — reaproveita 100% as fórmulas existentes, nenhuma fórmula nova.
    - **Insights automáticos em texto** (decisão do usuário: "sim, com
      frases automáticas"): regras simples e transparentes, sem IA —
      sequência de altas/baixas consecutivas ("ROE em alta há 3 trimestres
      seguidos") e recordes do histórico lançado ("Margem Líquida no maior
      nível do histórico lançado"), geradas por `gerarInsightsAcao`/`Fii`
      em cima da mesma série + Receita Líquida/Lucro Líquido (Ações) ou
      Receita Imobiliária (FIIs). Limitado a 6 insights pra não poluir a
      tela, priorizando receita/lucro primeiro, depois rentabilidade,
      depois alavancagem/liquidez.
    - Painel só aparece com 2+ trimestres lançados (mínimo pra qualquer
      tendência fazer sentido); cálculo 100% client-side a partir de
      `checklist.resultados` (já carregado, sem round-trip novo ao
      servidor).

#### Schema planejado (seção 8.10)

- `ativos`: adicionar `'etf'` ao check constraint de `tipo`; nova coluna
  `cotacao_automatica boolean not null default false` (liga/desliga por
  ativo se o cron/botão deve tentar buscar — desligado por padrão pra
  `renda_fixa`/`fundo`/`outro`, ligado por padrão pros tipos cotáveis);
  `preco_fonte text` (`'yahoo_finance' | 'manual' | null`) pra UI mostrar
  a procedência do último preço salvo.
- `ativo_checklist`: uma linha por ativo (`ativo_id` unique), com os
  campos manuais que não vêm de `ativo_resultado_trimestral` — hoje só
  `saldo_acionistas text` (Ações/ETF) e, pro grupo FIIs, os campos que o
  Yahoo/CVM não cobrem de forma confiável de graça (nenhum obrigatório —
  ver decisão 6, o resto é sempre calculado).
- `ativo_resultado_trimestral`: uma linha por ativo + competência
  (`ano_trimestre` tipo "2026-Q2"), campos nulos por padrão. Grupo
  Ações/ETF/Internacional: `receita_liquida`, `lucro_bruto`,
  `lucro_liquido`, `ebit`, `ebitda`, `patrimonio_liquido`, `ativo_total`,
  `ativo_circulante`, `passivo_circulante`, `divida_liquida`,
  `divida_bruta`, `numero_acoes`. Grupo FIIs: `valor_patrimonial_cota`,
  `numero_negocios_mes`, `vacancia_financeira_pct`, `vacancia_fisica_pct`,
  `receita_imobiliaria`, `valor_avaliacao_imoveis`, `valor_m2_aluguel`.
  RLS igual ao resto do app (`auth.uid() = profile_id`, via join com
  `ativos`).

#### Motor de cálculo — desenho antes de codar

- `lib/ativos/yahoo-finance.ts`: função que deriva o símbolo Yahoo a
  partir de tipo+ticker (mesma lógica de `deriveTradingViewSymbol`, mas
  pro sufixo do Yahoo) e busca a cotação atual; tolera falha (endpoint
  não-oficial) sem derrubar o resto da chamada.
- `src/app/api/cron/cotacoes/route.ts`: mesmo padrão do cron do Dólar —
  Route Handler, `CRON_SECRET`, cliente admin (reaproveita
  `src/lib/supabase/admin.ts` já existente) — mas em vez de uma tabela
  compartilhada, atualiza `preco_atual`/`preco_atualizado_em`/`preco_fonte`
  de todos os `ativos` de todos os usuários com `cotacao_automatica = true`
  numa varredura.
- `lib/ativos/checklist-estatisticas.ts`: funções puras que recebem o
  histórico de `ativo_resultado_trimestral` de um ativo + preço atual e
  devolvem os dois conjuntos de índices (Ações/ETF/Internacional vs
  FIIs), reaproveitando o TTM/CAGR/margem como funções genéricas
  (parecido com `dolar-estatisticas.ts`/`ipca-estatisticas.ts`).

#### Fora de escopo por enquanto

- **brapi.dev (ou qualquer API paga)**: decisão explícita de não assinar
  agora — reavaliar se o Yahoo Finance se mostrar instável demais na
  prática.
- **Pipeline de ETL da CVM (ITR/DFP em massa)**: os dados trimestrais
  ficam manuais; automatizar a partir dos arquivos abertos da CVM é um
  projeto à parte, bem maior que isso aqui.
- **Métricas de ETF "puro"** (taxa de administração, tracking error,
  patrimônio líquido do fundo): o checklist de ETF reaproveita o template
  de Ações por pedido explícito; métricas específicas de ETF ficam de
  fora por enquanto.
- **Cotação automática pra `renda_fixa`/`fundo`/`outro`**: continuam 100%
  manuais (ver decisão 4).

### 8.11 Correções tomadas em 2026-07-14 (revisão geral: IR, Carteira, Proventos, Alocação)

Decorrentes da revisão de lógica de negócio de 2026-07-14 (documento
`docs/REVISAO-MELHORIAS-2026-07-14.md`), quatro correções confirmadas pelo
Guilherme e já implementadas:

1. **Compensação de prejuízo no IR atravessa anos-calendário, sem
   prescrição.** Confirmado por pesquisa (Receita Federal, gov.br): na
   renda variável, prejuízo apurado em qualquer mês/ano pode abater lucro
   de qualquer mês/ano seguinte, indefinidamente, desde que informado
   anualmente na Ficha de Renda Variável — não existe prazo de validade.
   Antes, `lib/ir/actions.ts#obterRelatorioIR` filtrava as vendas pro ano
   selecionado **antes** de rodar o ledger de prejuízo por categoria, então
   um prejuízo de dezembro/2025 não abatia um lucro de janeiro/2026. Agora
   o ledger (`prejuizoAcumuladoPorCategoria`) roda sobre `todasVendas` (todo
   o histórico, todos os anos), mês a mês, cronologicamente; só a decisão
   de **emitir** a linha em `mensal[]` é filtrada pelo `ano` pedido
   (`emitirLinha = anoMes.startsWith(String(ano))`) — o estado do ledger
   continua sendo atualizado mesmo nos meses não emitidos. O mesmo
   princípio foi replicado num ledger **anual** separado (não mensal) para
   as categorias de apuração anual (`cripto_estrangeira`, `internacional`).
   Campo novo `LinhaMensal.prejuizoAnteriorAplicado` deixa explícito, linha
   a linha, quanto de prejuízo de meses/anos anteriores foi usado naquele
   mês (redundância de informação proposital — ver seção 3).

2. **Venda validada contra a posição no ponto do tempo, não a posição final
   agregada.** Antes, `lib/carteira/actions.ts#criarTransacao` validava uma
   venda contra `obterAtivosComPosicao()` (posição final, somando TODAS as
   transações já lançadas, inclusive as com data posterior à da venda). Isso
   permitia lançar uma venda retroativa que ficava negativa naquele ponto da
   linha do tempo, desde que uma compra futura (também lançada
   retroativamente) "cobrisse" o buraco no total. Correção: nova função
   `lib/ativos/actions.ts#obterQuantidadeDisponivelEmData(ativoId,
   dataLimite)` recalcula a posição usando só as transações com
   `data <= dataLimite`, reaproveitando as mesmas `calcularPosicao`/
   `ordenarTransacoes` privadas (fonte única, seção 3) em vez de duplicar o
   cálculo. `criarTransacao` agora valida a venda contra esse número.

3. **Proventos ganharam edição e seleção múltipla.** `lib/proventos/actions.ts`
   ganhou `editarProvento(id, input)` e `excluirProventosEmLote(ids[])`
   (a exclusão individual já existia). UI (`ProventosView.tsx`) ganhou
   checkbox por linha + "selecionar todos", barra de ação em lote com
   confirmação em duas etapas, e edição inline (troca a linha pelo form
   preenchido, mesmo padrão usado em Alocação).

4. **Validação redundante (client + server) de soma de peso-alvo em 100%.**
   Pedido explícito do Guilherme foi "buscar um app redundante evitando
   esses erros" — interpretado como duas camadas independentes, não
   mutuamente substituíveis: (a) `lib/alocacao/actions.ts` agora calcula a
   soma dos pesos-alvo dos irmãos (outras classes, ou outros setores dentro
   da mesma classe) antes de qualquer `criarClasse`/`editarClasse`/
   `criarSetor`/`editarSetor`, e recusa com erro descritivo se a soma
   passaria de `100 + TOLERANCIA_SOMA_PESO` (0.01pp de tolerância pra ponto
   flutuante); (b) `AlocacaoView.tsx`/`ClasseRow.tsx` mostram um indicador
   textual sempre visível (não só no momento do erro) com a soma atual dos
   pesos-alvo em cada nível, verde quando fecha ~100%, vermelho quando
   excede. As duas camadas ficam desacopladas de propósito: a validação do
   servidor é a que realmente impede dado inconsistente; o indicador visual
   é só uma leitura auxiliar (mesma filosofia de redundância de informação
   da seção 3), útil mesmo quando o usuário ainda não tentou salvar.

Também corrigido, junto dessas quatro (mesmo lote de commits): em
`AlocacaoView.tsx`/`ClasseRow.tsx`/`SetorRow.tsx`/`ProventosView.tsx`, os
handlers de criar/editar que fecham um formulário após salvar agora
`await`am o refetch (`onChange()`/`atualizar()`) **antes** de fechar o
formulário (`setEditando(false)` etc.), nunca depois — fechar antes do
refetch resolver deixava a tela parecendo travada/desatualizada em cold
starts da Vercel.

### 8.12 Histórico de preço diário por ativo + rentabilidade histórica real (2026-07-14)

Item "Investimento #3" da revisão de 2026-07-14, confirmado pelo Guilherme
como "SIM, de extrema importância". Antes desta decisão, a única noção de
retorno de um ativo era pontual — `lib/ativos/actions.ts#obterAtivosComPosicao`
compara só o `preco_atual` (um único número, sobrescrito a cada atualização)
contra o custo médio ATUAL, ou seja, dava pra saber "quanto rendi até agora",
nunca "quanto eu tinha rendido há 3 meses". As decisões abaixo foram
tomadas via perguntas objetivas ao Guilherme antes de codar (protocolo da
seção 1):

1. **Backfill completo via Yahoo, não só acúmulo dia a dia a partir de
   hoje.** O endpoint não-oficial do Yahoo Finance já usado para cotação
   atual (`lib/ativos/yahoo-finance.ts#buscarCotacaoYahoo`, `range=1d`)
   aceita ranges maiores no mesmo endpoint — nova função
   `buscarHistoricoYahoo(symbol, range)` reaproveita a mesma URL só trocando
   o parâmetro. No primeiro cron após um ativo virar `cotacao_automatica`,
   busca `range=10y` de uma vez; escolhido em vez de "só daqui pra frente"
   porque a rentabilidade histórica só fica útil imediatamente com dados
   retroativos, não depois de meses de uso.

2. **Duas tabelas com escopos diferentes, não uma só.** Ao decidir o
   desenho da tabela, ficou claro que preço de mercado (ação/FII/ETF/
   internacional/cripto) é um dado OBJETIVO — PETR4 vale o mesmo pra
   qualquer usuário — enquanto o preço de tipos manuais (`renda_fixa`,
   `fundo`, `outro`) é subjetivo: o "ticker" desses é só um rótulo que cada
   usuário inventa (dois "CDB-ITAU" de pessoas diferentes são instrumentos
   diferentes), não um símbolo de mercado público. Por isso:
   - `ativo_preco_diario_mercado` — chave `(tipo, ticker, data)`, **sem**
     `profile_id`, mesmo padrão de dado compartilhado de
     `indicador_dolar_diario` (seção 13): 1 fetch no cron serve todo mundo
     que tem aquele ticker, e RLS é só-leitura pra `authenticated` (escrita
     só via cron, service role).
   - `ativo_preco_diario_manual` — chave `(ativo_id, data)`, **com**
     `profile_id`, RLS padrão "all own". Um ponto por dia: sempre que
     `atualizarPrecoAtual` salva um preço manual, faz upsert do snapshot do
     dia (não acumula intraday — a segunda atualização no mesmo dia
     sobrescreve a primeira).

3. **Cron de cotações ganhou uma segunda fase, sem duplicar trabalho por
   usuário.** `src/app/api/cron/cotacoes/route.ts` já varria `ativos` de
   todos os usuários pra atualizar `preco_atual` (fase 1, inalterada). Fase
   2 nova: agrupa os ativos varridos em combinações únicas de `(tipo,
   ticker)` antes de tocar `ativo_preco_diario_mercado` — processa cada
   combinação uma vez só por execução, mesmo que N usuários tenham o mesmo
   ticker. Decide `range=10y` (backfill) ou `range=5d` (manutenção
   incremental, cobre feriado/fim de semana sem furo) checando se já existe
   alguma linha pra aquela combinação.

4. **Motor de rentabilidade histórica cruza preço × posição dia a dia, sem
   duplicar a fórmula de custo médio.** O corpo do loop de
   `calcularPosicao` (fonte única de verdade, seção 3) foi extraído pra uma
   função pura exportada, `aplicarTransacaoNaPosicao` (um "passo" que recebe
   `EstadoPosicao` + uma transação e devolve o novo estado) — `calcularPosicao`
   virou só um fold dessa função sobre a lista inteira, comportamento idêntico
   a antes. Novo módulo `lib/ativos/preco-historico.ts` anda pela série de
   preço em ordem cronológica aplicando `aplicarTransacaoNaPosicao` conforme a
   linha do tempo avança, obtendo quantidade e custo médio EM CADA DATA da
   série de preço (não só hoje) — daí `rentabilidadePct = (preço do dia −
   custo médio naquele dia) / custo médio naquele dia`. Mesmo princípio de
   reuso já usado pela decisão 2 da seção 8.11 (`obterQuantidadeDisponivelEmData`).

   **Correção 2026-07-14 (pós-deploy):** essas funções (`aplicarTransacaoNaPosicao`,
   `precoMedioDoEstado`, `calcularPosicao`, `ordenarTransacoes`) moraram
   inicialmente dentro de `lib/ativos/actions.ts`, que tem `"use server"` no
   topo — e no Next.js, TODO export de um arquivo `"use server"` vira Server
   Action, que é obrigada a ser `async`. Como essas funções são síncronas de
   propósito (só matemática, chamadas em loop), isso quebrou o build de
   produção (`next build`/Turbopack: "Server Actions must be async functions")
   sem que `tsc --noEmit`/`eslint` acusassem nada — é uma checagem exclusiva
   do compilador do Next, invisível neste sandbox (que não roda `next build`,
   ver CLAUDE.md §3). Fix: extraídas pra `lib/ativos/posicao-calculo.ts`, um
   módulo puro SEM `"use server"`, importado tanto por `actions.ts` quanto por
   `preco-historico.ts`. **Regra geral daqui pra frente:** função pura/síncrona
   que precisa ser compartilhada com ou usada dentro de um arquivo
   `"use server"` deve morar num módulo separado sem a diretiva — nunca ser
   exportada diretamente de dentro do arquivo `"use server"`.

5. **Escopo de UI: por ativo E patrimônio agregado (não só um dos dois).**
   Perguntado explicitamente, o Guilherme pediu ambos: (a) gráfico de
   rentabilidade % na página do ativo (`AtivoDetalheView.tsx`, seção
   "Rentabilidade histórica", só aparece se o ativo já tem transação
   lançada); (b) evolução do patrimônio total investido — soma, dia a dia,
   de `preço histórico × quantidade` de todos os ativos do usuário — na
   página `/dashboard` (que antes era só um placeholder "as próximas abas
   serão construídas aqui", agora vira o Painel de fato). Função
   `obterEvolucaoPatrimonio()` reaproveita `obterRentabilidadeHistoricaAtivo`
   por ativo (não recalcula a fórmula) e faz *forward-fill* entre ativos com
   calendários de preço diferentes (ex. um ativo com histórico mais curto
   que outro).

6. **Gráfico próprio em SVG puro, sem lib externa.** Não havia nenhuma
   dependência de charting no projeto (`recharts` etc. não instalados) — em
   vez de adicionar uma dependência nova, `src/components/SerieLinhaChart.tsx`
   extrai e generaliza o padrão de gráfico de linha já usado em
   `AbaDolar.tsx` (`GraficoDolarSvg`, indicadores macro), reaproveitável por
   qualquer série `{ data, valor }[]` — usado tanto pela rentabilidade por
   ativo quanto pela evolução de patrimônio.

#### Schema (seção 8.12)

```sql
-- Compartilhada por (tipo, ticker) — igual pra todo mundo, sem profile_id.
ativo_preco_diario_mercado (id, tipo, ticker, data, preco, created_at)
  unique (tipo, ticker, data)
  RLS: só SELECT para authenticated; escrita só via service role (cron).

-- Por ativo do usuário — profile_id + ativo_id, RLS padrão.
ativo_preco_diario_manual (id, profile_id, ativo_id, data, preco, created_at)
  unique (ativo_id, data)
  RLS: all own (auth.uid() = profile_id).
```

#### Fora de escopo por enquanto

- Preço intraday/tick a tick — só fechamento diário, mesma granularidade do
  resto do app (Dólar, IPCA, Selic).
- Rentabilidade ajustada por proventos reinvestidos (a rentabilidade aqui é
  só variação de preço vs. custo médio; proventos recebidos continuam
  contabilizados separadamente em `retornoTotal`, sem se misturar à curva).
- Backfill retroativo pra tipos manuais (`renda_fixa`/`fundo`/`outro`) — não
  existe fonte de preço histórico pra esses, então o histórico só começa a
  existir a partir da primeira vez que o usuário salva um preço manual
  depois desta feature existir.

### 8.13 UX/UI — confirmação de exclusão padronizada + toast/snackbar (2026-07-15)

Itens #121 e #122 do backlog, atacados juntos por serem a mesma classe de
mudança (padrão de feedback ao usuário) tocando praticamente todas as telas
do app. Decisões levantadas via protocolo da seção 1 (uma pergunta por vez):

1. **Confirmação de exclusão: modal centralizado, não banner inline.** Já
   existia um padrão de confirmação inline (banner "Excluir?" com
   Cancelar/Confirmar embutido na própria linha, usado em `SetorRow.tsx`/
   `ClasseRow.tsx`/`AtivoDetalheView.tsx`) convivendo com várias telas que
   excluíam **sem confirmação nenhuma** (transações, corretoras, resultados
   trimestrais, lançamentos de indicadores, cadastros de referência em
   Configurações). Escolhido consolidar tudo num único componente
   `src/components/ConfirmModal.tsx` — backdrop escurecido + card
   centralizado (`title`, `message`, `confirmLabel`, `onConfirm`, `onCancel`,
   `loading`) — em vez de generalizar o banner inline, para dar um padrão
   visualmente inequívoco (o usuário não confunde com o resto da UI) e
   consistente em toda tela, incluindo exclusões em lote (mesma modal,
   mensagem com a contagem). Aplicado a TODA ação de exclusão do app —
   inclusive as 3 que já tinham o banner antigo, substituído pela modal.

2. **Toast/snackbar substitui as duas variantes do padrão anterior
   (`.error-box`/`.success-box` ligados a `errors.root` do react-hook-form
   ou a estado local ad-hoc).** Novo `src/components/ToastProvider.tsx`
   (Context + hook `useToast()`, `success()`/`error()`, auto-dismiss em 4s/6s)
   montado uma única vez no layout raiz (`src/app/layout.tsx`, não no layout
   do grupo `(app)`) para funcionar também nas telas fora da área logada
   (login, cadastro, esqueci-senha, redefinir-senha, suitability). Cobre
   tanto confirmações de sucesso ("Transação excluída.", "Ativo salvo.")
   quanto erros de ação (falha ao salvar/excluir, falha de login) — em todo
   catch de submit que antes fazia `setError("root", { message })` +
   renderizava `.error-box`, a chamada virou `toast.error(...)`.

3. **Exceção deliberada: erro de campo específico (`field-error`,
   validação Zod por input) fica exatamente onde está, nunca vira toast.**
   Um toast não indica QUAL campo está errado e desaparece antes que o
   usuário necessariamente leia e corrija — então só o padrão "ação falhou
   como um todo" (`errors.root`/estado de erro solto, não ligado a um campo)
   foi convertido. As duas páginas de fluxo de senha que usam
   `useActionState` (não react-hook-form) seguem o mesmo princípio via
   `useEffect` observando `state.error` e chamando `toast.error(...)`.

4. **Exceção deliberada: painéis de resultado ricos (import em lote de
   Selic/IPCA, "aguarde confirmação por email" em `esqueci-senha`) NÃO
   viraram toast.** Esses blocos carregam informação estruturada que precisa
   ficar visível além de alguns segundos (contagem de linhas importadas +
   lista de avisos; instrução "confira sua caixa de entrada e o spam") — um
   toast de 4-6s cortaria a leitura ou removeria a única indicação de que
   algo aconteceu (a tela ficaria em branco depois do toast sumir, já que o
   formulário correspondente desaparece nesses dois casos). Mantidos como
   painel inline persistente; só o erro de importação em si (`resultado.error`
   dentro desse mesmo painel) segue as mesmas classes CSS de sempre, sem
   toast, por ser parte do mesmo bloco de resultado — não um erro de ação
   solto.

Arquivos tocados (não exaustivo, ~15 arquivos): `AtivoDetalheView.tsx`,
`AtivosView.tsx`, `SetorRow.tsx`, `ClasseRow.tsx`, `AlocacaoView.tsx`,
`CarteiraView.tsx`, `CorretorasManager.tsx`, `ProventosView.tsx`,
`IndicadoresView.tsx`, `AbaSelic.tsx`, `AbaIpca.tsx`,
`ConfiguracoesForm.tsx`, `login/page.tsx`, `esqueci-senha/page.tsx`,
`redefinir-senha/page.tsx`, `cadastro/CadastroWizard.tsx`,
`components/suitability/SuitabilityWizard.tsx`. Nova classe `.btn-danger`
em `globals.css` para o botão de confirmar exclusão da modal.

### 8.14 Indicadores — migração para Recharts, banda de meta em degraus, stats duplicadas no topo, e dois bugs do Dólar (2026-07-15)

Guilherme reportou, a partir de screenshots da aba Indicadores em produção,
que os três gráficos (Selic/IPCA/Dólar) precisavam de mais informação e
tooltip ao passar o mouse, que o gráfico do IPCA não desenhava a meta de
inflação cadastrada em Configurações, que as estatísticas do histórico
(Selic e IPCA) só apareciam no rodapé, e que o Dólar não estava trazendo o
histórico de cotação atualizado. Decisões levantadas via protocolo da seção
1 (uma pergunta por vez, com mockups visuais antes de cada pergunta):

1. **Troca de motor de gráfico: SVG artesanal → Recharts.** A decisão
   original (§8.7, "sem nova dependência") foi revertida deliberadamente —
   Guilherme escolheu "Trocar por Recharts" ao ver os dois modelos lado a
   lado, priorizando tooltip nativo com valor + competência/data e menos
   código de desenho manual (paths SVG, ticks, eixo) sobre o risco de
   instalação de dependência nova. `recharts@2.15.4` foi instalado com
   sucesso (`npm install recharts@2 --save`). Os três gráficos
   (`GraficoSelicRecharts` em `AbaSelic.tsx`, `GraficoIpcaRecharts` em
   `AbaIpca.tsx`, `GraficoDolarRecharts` em `AbaDolar.tsx`) foram
   reescritos usando `ResponsiveContainer`/`LineChart`/`ComposedChart` +
   um componente de tooltip customizado por aba (`TooltipSelic`,
   `TooltipIpca`, `TooltipDolar`) que lê o `payload` do Recharts e formata
   valor(es) + data/competência no mesmo estilo visual do resto do app
   (`bg-surface-2`, `border-border-strong`). O componente genérico
   `SerieLinhaChart.tsx` (usado em Ativo/rentabilidade) **não foi tocado**
   — é compartilhado com outras features e ficou fora do escopo deste
   pedido; cada aba de Indicadores agora tem seu próprio componente de
   gráfico Recharts local, não um componente genérico entre as três.
2. **Banda de meta do IPCA: histórica "em degraus", não só a meta de
   hoje.** O gráfico do IPCA passou a desenhar a banda
   (`bandaInferior`/`bandaSuperior`) e a linha central (`metaCentral`) da
   meta de inflação vigente **em cada época**, não uma banda fixa com o
   valor atual aplicado a todo o histórico — reaproveita
   `encontrarMetaVigente()` (já existente em `ipca-estatisticas.ts`, mesma
   função usada no servidor em `obterIpca()`) competência a competência,
   agrupando em segmentos contíguos (`segmentosMetaPorCompetencia()`, novo,
   em `AbaIpca.tsx`) sempre que a meta vigente muda de `id`. Cada segmento
   vira um par `ReferenceArea` (banda) + `ReferenceLine` (linha central) do
   Recharts, renderizados só entre o `anoMesInicio`/`anoMesFim` daquele
   segmento — visualmente, a banda "sobe e desce em degraus" acompanhando
   as metas históricas cadastradas.
3. **Estatísticas do histórico duplicadas no topo, bloco completo (não
   resumido).** Tanto em Selic quanto em IPCA, o bloco de estatísticas
   (`StatsResumo`/`StatsResumoIpca`) — que antes só existia dentro de
   `BlocoHistorico`, no rodapé — passou a ser renderizado **também** logo
   após os cards, no topo da aba, com o mesmo nível de detalhe completo nos
   dois lugares (não uma versão condensada no topo). Decisão explícita do
   Guilherme ("bloco completo e tudo no topo") ao comparar com a alternativa
   de uma faixa resumida. Implementado como duplicação direta do mesmo
   componente em dois pontos da árvore — sem introduzir estado novo nem
   lógica condicional — porque o bloco já é derivado (calculado a partir de
   `ipca`/`selic` na leitura, ver §3 "fonte única de verdade"): duplicar a
   *exibição* de um valor já calculado não viola a regra, só duplicaria
   dado se fosse armazenado duas vezes no banco.
4. **Dólar: dois bugs reais encontrados e corrigidos, não relacionados à
   troca de gráfico.** O sintoma relatado ("não está com o histórico da
   cotação atual") foi diagnosticado em duas camadas:
   - **Bug real (causa raiz): `obterDolar()` em `lib/indicadores/actions.ts`
     buscava a tabela `indicador_dolar_diario` sem paginação.** O Supabase/
     PostgREST tem um teto rígido de linhas por resposta (`db-max-rows`,
     default 1000) que um `.range()` maior no cliente **não consegue
     ultrapassar** — o servidor corta em 1000 linhas independentemente do
     range pedido. Como a tabela tem ~6900 linhas (desde 1999) ordenadas
     ascendente, a UI só via as 1000 mais antigas — daí a tela mostrar
     cotação de 2002. Corrigido com um novo helper
     `buscarTodasCotacoesDolar()` que pagina em loop (`.range(pagina*1000,
     pagina*1000+999)`) até uma página vir com menos de 1000 linhas. O
     mesmo bug existia em `detectarBuracos()` (rota de diagnóstico do cron,
     `src/app/api/cron/dolar/route.ts`) e foi corrigido do mesmo jeito.
     **Esse foi o fix que efetivamente resolveu o problema em produção**,
     confirmado pelo Guilherme.
   - **Robustez defensiva no cron (não era a causa raiz, mas ficou
     corrigida):** `JANELA_MAX_DIAS` reduzida de 3650 para 1095 dias por
     chamada à API do Bacen (menor risco de truncamento silencioso de uma
     janela grande), e o cursor de busca passou a avançar a partir da
     **última data efetivamente recebida** na resposta do Bacen — não do
     fim da janela pedida — para que um truncamento silencioso não deixe
     mais um buraco permanente no histórico. Dois novos modos de
     diagnóstico/manutenção na mesma rota: `?modo=diagnostico` (só leitura:
     total de linhas, primeira/última data, buracos) e
     `?modo=preencherGaps` (detecta e busca especificamente os intervalos
     faltantes).

Arquivos tocados: `src/app/(app)/indicadores/AbaSelic.tsx`, `AbaIpca.tsx`,
`AbaDolar.tsx` (reescritos com Recharts), `src/lib/indicadores/actions.ts`
(paginação de `obterDolar()`), `src/app/api/cron/dolar/route.ts`
(paginação de `detectarBuracos()` + robustez de janela/cursor + modos de
diagnóstico), `package.json` (nova dependência `recharts@2`).

### 8.15 Rentabilidade histórica — janela primeira negociação→venda, fórmula unificada Ativo/Carteira, gráfico da Carteira em % (2026-07-15)

Guilherme apontou, olhando a página de um FII (HGBS11) em produção, que o
bloco "Rentabilidade histórica" do Ativo mostrava "poucos pontos" e pediu
pra estudar e melhorar a regra: tanto no Ativo quanto na Carteira, a
rentabilidade histórica deveria ir da primeira negociação até a venda.
Investigação + decisões via protocolo da seção 1 (uma pergunta por vez):

1. **O que já estava certo, o que não existia.** No nível do Ativo, o início
   já era filtrado corretamente pela primeira transação
   (`transacoes[0].data`, em `obterRentabilidadeHistoricaAtivo`) — o sintoma
   do HGBS11 era falta de dado histórico de preço, não um bug de data de
   início. O que **não existia de fato** era uma curva de rentabilidade em
   **%** pra Carteira inteira — só havia "Evolução do patrimônio" em R$
   absoluto no Dashboard (`obterEvolucaoPatrimonio`, agora `obterEvolucaoCarteira`).
2. **Metodologia escolhida: "retorno simples acumulado".** Descartada a
   alternativa de retorno indexado por cota (TWR, estilo fundo de
   investimento — mais correto matematicamente na presença de aportes ao
   longo do tempo, mas exige uma estrutura de "cota" que não existe no app e
   é bem mais difícil de auditar manualmente). Fórmula adotada, igual para
   Ativo e Carteira: `(valorPosicao + lucroRealizadoAcumulado) / totalInvestidoBruto − 1`.
   `totalInvestidoBruto` é um acumulador NOVO em `EstadoPosicao`
   (`posicao-calculo.ts`) que só cresce em compras (nunca reduz na venda,
   diferente de `custoTotal`) — sem ele não dava pra medir corretamente o
   retorno de um ativo parcialmente vendido, já que `custoTotal` sozinho
   "esquece" o que já saiu da posição.
3. **Unificação deliberada Ativo↔Carteira.** Antes, o Ativo comparava só
   preço atual vs. custo médio (ignorava vendas parciais já feitas). Decisão
   explícita do Guilherme: unificar — agora o Ativo também soma o lucro já
   realizado ao numerador, então os dois níveis (Ativo e Carteira agregada)
   medem exatamente a mesma coisa, e a Carteira é uma soma direta dos
   acumuladores de cada Ativo (sem duplicar fórmula).
4. **Corte da série na venda final.** Se a posição de um Ativo zera e nunca é
   recomprada, a série de `obterRentabilidadeHistoricaAtivo` agora é
   truncada no dia dessa venda (mantendo esse último ponto, com o retorno
   final "congelado") — não continua um rastro de dias mortos com o mesmo
   número até hoje. Efeito colateral correto e automático em
   `obterEvolucaoCarteira`: o forward-fill por ativo trava nesse último
   ponto, então a contribuição desse ativo fica "congelada" dali em diante —
   sem lógica extra pra isso, é consequência direta do corte de cada série.
5. **Onde aparece e como.** Novo gráfico de % no Dashboard, no MESMO bloco
   de "Evolução do patrimônio" (não em tela separada), com um toggle R$/%
   (`EvolucaoCarteiraBlock.tsx`, client component — o resto do Dashboard
   continua server component, só esse bloco precisa de estado local pro
   toggle). Preferido a mostrar os dois gráficos lado a lado, pra manter o
   bloco compacto.

Arquivos tocados: `src/lib/ativos/posicao-calculo.ts` (`totalInvestidoBruto`
em `EstadoPosicao`/`aplicarTransacaoNaPosicao`), `src/lib/ativos/preco-historico.ts`
(nova fórmula + corte em `obterRentabilidadeHistoricaAtivo`; `obterEvolucaoPatrimonio`
virou `obterEvolucaoCarteira`, retornando R$ e % juntos), `src/app/(app)/dashboard/page.tsx`
e novo `src/app/(app)/dashboard/EvolucaoCarteiraBlock.tsx` (toggle R$/%),
`src/app/(app)/ativos/[id]/AtivoDetalheView.tsx` (texto explicativo
atualizado pra refletir a nova fórmula).

### 8.16 Carteira → sub-aba Posição (visão consolidada por classe) + Livro-razão só compra/venda (2026-07-16 a 2026-07-20)

Guilherme mandou 4 prints de uma "POSIÇÃO NA CARTEIRA" estilo MyProfit/Status
Invest (seções por classe — Ações, FIIs, Tesouro, Stocks, ETF Exterior —
cada uma com resumo HOJE/TOTAL, badge de % da carteira, tabela ordenável) e
pediu pra elaborar a aba Carteira nesse padrão, lendo do que já é lançado no
livro-razão. Investigação + decisões via protocolo da seção 1:

1. **Carteira virou aba-mãe com 2 sub-abas.** `Posição` (nova, default) e
   `Livro-razão` (a antiga tela única da Carteira, sem mudança de
   comportamento além do item 6 abaixo). Mesmo padrão de sub-abas de
   `ConfiguracoesForm.tsx`/`IndicadoresView.tsx` (estado local `useState<AbaId>`,
   sem sync com URL) — implementado em `CarteiraView.tsx`, que agora só é o
   wrapper das duas; o conteúdo de cada sub-aba mora em `PosicaoView.tsx` e
   `LivroRazaoView.tsx` (novo, extraído do antigo `CarteiraView.tsx`).
2. **Stock vs ETF Exterior exige campo novo.** O tipo `internacional` sempre
   foi um bucket único (ação e ETF exterior misturados, ver §14.1) — pra
   replicar os grupos separados do print, criei `subtipo_internacional`
   (`'acao' | 'etf' | null`) em `ativos`, mesmo espírito de
   `subtipo_renda_fixa`/`cripto_exchange` (opcional, sem efeito em cotação/IR,
   só na visualização). Migração em `supabase/schema.sql` §16. Exposto em
   `AtivoResumo` e nos dois formulários de ativo (criação e edição) como
   select "Ação ou ETF? (para agrupar na Posição)", com opção "Não informar
   agora" — quem não preencher cai num grupo `internacional_outros` separado
   em vez de a Posição adivinhar.
3. **Escopo: fidelidade total ao print, tudo de uma vez** (decisão do
   Guilherme entre as opções apresentadas) — sorting por coluna, paginação
   por linhas/página (10/25/50/100), filtro de corretora/banco e exportação
   CSV entraram todos nesta entrega, não em fatias.
4. **"Variação hoje" — regra de comparação.** Decisão do Guilherme: comparar
   sempre com o último preço salvo, seja de quando for (não só "ontem"). Para
   tipos com cotação automática (`TIPOS_COTACAO_AUTOMATICA`), os 2 últimos
   pontos vêm de `ativo_preco_diario_mercado` (tabela compartilhada por
   tipo+ticker, cron diário) numa janela de 15 dias corridos — folga
   suficiente pra pular fim de semana/feriado sem custar uma query por
   ativo. Para tipos manuais (`renda_fixa`, `fundo`, `outro`), os 2 últimos
   snapshots vêm de `ativo_preco_diario_manual`, **sem corte de data**
   (snapshot manual pode ficar semanas parado — cortar por janela quebraria a
   regra "seja de quando for"). Ativo com menos de 2 pontos conhecidos mostra
   "—" em vez de zero (não distorce a agregação do grupo).
5. **"Variação total" — fórmula unificada, não nova.** Reaproveita a mesma
   "retorno simples acumulado" da §8.15 (já exposta em `AtivoResumo` como
   `rentabilidadeTotalValor`/`rentabilidadeTotalPct`), agregada por grupo e
   pro total da carteira somando `lucroRealizado`/`totalInvestidoBruto` dos
   ativos do grupo antes de aplicar a fórmula — não é média das % de cada
   ativo (evita viés de ativo pequeno pesando igual a um grande).
6. **Livro-razão perdeu toda leitura de provento** (não só a lista — pergunta
   feita ao Guilherme sobre manter o card-resumo "Proventos recebidos
   (total)" como referência: resposta foi remover também). `obterLivroRazao`
   não faz mais `select` em `proventos`; `LancamentoProvento`/`proventosTotal`
   foram removidos de `lib/carteira/actions.ts`. Leitura/escrita de provento
   é 100% exclusiva de `lib/proventos/actions.ts` (aba Proventos) — sem
   duplicar em nenhum outro lugar.
7. **Filtro por corretora recalcula posição, não filtra o resultado.**
   `corretora_id` mora em `transacoes`, não em `ativos` — não dá pra "filtrar"
   a posição já calculada. `obterPosicaoConsolidada(corretoraId?)` refaz o
   fold `ordenarTransacoes`/`calcularPosicao` (mesmas funções puras de
   `posicao-calculo.ts`, fonte única) só sobre as transações daquela
   corretora antes de somar — cada corretora é tratada como um sub-livro
   independente do mesmo ativo. Ativo que zera sob o filtro (ex.: só foi
   comprado noutra corretora) some da Posição filtrada, mesmo se em outras
   corretoras ainda tiver posição — comportamento esperado, é "o que estou
   naquela corretora".
8. **Agrupamento por classe** (`grupoDoAtivo` em `lib/carteira/posicao.ts`):
   `acao`→Ações, `fii`→FIIs, `etf`→ETF Brasil, `renda_fixa` com
   `subtipo_renda_fixa === 'tesouro'`→Tesouro Direto (senão→Renda Fixa),
   `fundo`→Fundos de Investimento, `cripto`→Criptomoedas,
   `internacional`→Stocks/ETF Exterior/Internacional (não classificado)
   conforme item 2, `outro`→Outros. Ordem de exibição fixa
   (`ORDEM_GRUPOS`), replicando a sequência do print. Ativo com quantidade
   zero (sob o filtro de corretora aplicado, se houver) não entra na
   Posição — "posição" é só o que ainda está em carteira.

Arquivos tocados: `supabase/schema.sql` §16 (`subtipo_internacional`),
`src/lib/ativos/posicao-calculo.ts` (`calcularPosicao` passou a expor
`totalInvestidoBruto`), `src/lib/ativos/schema.ts` (`SUBTIPOS_INTERNACIONAL`
+ campo no `ativoSchema`), `src/lib/ativos/actions.ts` (`AtivoResumo`
estendido com `subtipoInternacional`/`totalInvestidoBruto`/
`rentabilidadeTotalValor`/`rentabilidadeTotalPct`; `criarAtivo`/`editarAtivo`
persistindo o novo campo), `src/app/(app)/ativos/AtivosView.tsx` e
`src/app/(app)/ativos/[id]/AtivoDetalheView.tsx` (select de subtipo
internacional nos dois formulários), novo `src/lib/carteira/posicao.ts`
(motor da Posição consolidada), `src/lib/carteira/actions.ts` (proventos
removidos de `obterLivroRazao`/`LivroRazao`), novo
`src/app/(app)/carteira/PosicaoView.tsx`, novo
`src/app/(app)/carteira/LivroRazaoView.tsx` (extraído do antigo
`CarteiraView.tsx`), `src/app/(app)/carteira/CarteiraView.tsx` (virou
wrapper de sub-abas) e `src/app/(app)/carteira/page.tsx` (busca
`obterPosicaoConsolidada()` além do livro-razão).

### 8.17 Posição em produção — coluna faltando + 3 correções de robustez (2026-07-20)

Depois do deploy da §8.16, a Posição foi ao ar mostrando "Nenhuma posição em
carteira ainda" mesmo com ativos lançados. Investigação + correções:

1. **Causa raiz do incidente**: a migração `subtipo_internacional` (§8.16,
   item 2) tinha ficado só no `supabase/schema.sql` do repositório — nunca
   tinha sido rodada no banco de produção. Como `obterPosicaoConsolidada` e
   `obterAtivosComPosicao` selecionam essa coluna, a query falhava no
   Postgrest; corrigido rodando o `schema.sql` inteiro (idempotente) no SQL
   Editor do Supabase.
2. **Erro visível em vez de silêncio.** Nenhuma das duas funções acima
   checava o `error` do Supabase — uma coluna faltando (ou qualquer outra
   falha de query) fazia a função devolver `[]`/lista vazia sem pista
   nenhuma da causa, e foi exatamente isso que aconteceu aqui: a tela ficou
   vazia sem erro, sem log, sem nada pra investigar. Agora
   `obterAtivosComPosicao` (lib/ativos/actions.ts) e
   `obterPosicaoConsolidada` (lib/carteira/posicao.ts) checam `error` de
   cada query e lançam `Error` descritivo — Next mostra a tela de erro em
   vez de uma tela vazia, e a mensagem fica no log do servidor (Vercel).
3. **Variação hoje reconciliada com Patrimônio atual.** Achado na revisão
   pós-incidente: "Patrimônio atual" usa `ativos.preco_atual` (atualizado
   tanto pelo cron das 22h UTC quanto pelo botão "Atualizar agora", que só
   mexe nesse campo), enquanto "Variação hoje" comparava os 2 últimos pontos
   de `ativo_preco_diario_mercado`/`ativo_preco_diario_manual` (só o cron
   escreve ali). Resultado: clicar "Atualizar agora" no meio do dia
   atualizava o Patrimônio mas não a Variação hoje, que continuava
   comparando contra o snapshot velho do cron — os dois números paravam de
   bater. Correção: "hoje" na Variação hoje agora É `preco_atual` (mesma
   fonte do Patrimônio); só o "ontem" continua vindo do histórico diário —
   busca-se o preço mais recente salvo **estritamente antes de hoje**
   (`obterPrecoAnteriorMercado`/`obterPrecoAnteriorManual`, substituindo as
   antigas "2 últimos pontos"). Mantém a decisão original de 2026-07-16
   ("comparar com o último preço salvo, seja de quando for") pro lado
   manual, e resolve o drift do lado automático.
4. **Indicador de preço não definido na Posição.** `ativos.preco_atual`
   nasce `0` no banco — um ativo com posição mas cujo preço nunca foi
   definido aparecia na Posição como R$ 0,00 de patrimônio sem nenhum
   aviso (a página do Ativo já tinha esse aviso, a Posição não). Adicionado
   `precoDefinido: boolean` em `PosicaoAtivo` (`preco_atualizado_em !==
   null`): a UI agora mostra "—" em vez de R$ 0,00 nas colunas Preço
   atual/Diferença/Patrimônio atual desses ativos, com link "sem preço ·
   definir" pra página do ativo, um badge por classe ("N sem preço") e uma
   nota no resumo total explicando que esses ativos contam como R$ 0,00 nos
   totais (subestimando o valor real da carteira) até o preço ser definido.
   `PosicaoConsolidada`/`PosicaoGrupo` ganharam `ativosSemPrecoCount`/
   `semPrecoCount` pra isso.

**Não corrigido nesta rodada, registrado pra referência**: o cron de
cotações (`src/app/api/cron/cotacoes/route.ts`) usa a API não-oficial do
Yahoo Finance e falha por ticker sem alertar ninguém — se um ativo ficar
dias sem atualizar, não há nada na UI que avise. Fica como pendência futura
(ex.: um indicador de "cotação desatualizada há X dias" na página do ativo
ou na Posição).

Arquivos tocados: `src/lib/ativos/actions.ts` (`obterAtivosComPosicao` com
checagem de erro), `src/lib/carteira/posicao.ts` (checagem de erro +
`obterPrecoAnteriorMercado`/`obterPrecoAnteriorManual` substituindo
`obterUltimosDoisPrecosMercado`/`Manuais` + `precoDefinido`/
`semPrecoCount`/`ativosSemPrecoCount`), `src/app/(app)/carteira/PosicaoView.tsx`
(mascarar valores sem preço + badges de aviso).

### 8.18 Livro-razão — robustez de cadastro + filtros/edição em lote (2026-07-20)

Pedido do Guilherme (mensagem com print da sub-aba Livro-razão + tabela de
compra/venda mensal como referência): tornar o Livro-razão mais robusto
("base de alimentação de vários dados do app") e trazer filtros, edição e
seleção múltipla, já que hoje é só lançar e excluir uma linha por vez. Escopo
combinado via protocolo da seção 1 (uma pergunta por vez): esta rodada
("Fundação") cobre só robustez de cadastro + filtros/edição em lote — visão
mensal de compra/venda, gráfico de acúmulo de capital, eventos societários
(bonificação/agrupamento/desdobramento) e importação por copiar-colar ficam
como próximas etapas, uma de cada vez.

1. **Aviso de duplicidade (não bloqueio).** Decisão do Guilherme: ao lançar
   ou editar uma transação que bate com uma já existente (mesmo `ativo_id`,
   `data`, `tipo`, `quantidade` e `preco_unitario` — `custos`/`corretora_id`
   não entram na comparação de propósito), a UI mostra um modal perguntando
   "tem certeza?" em vez de recusar ou salvar direto. Se confirmar, reenvia a
   mesma chamada com `{ confirmarDuplicata: true }`, que pula a checagem.
   Implementado em `existeTransacaoDuplicada` (privada, `lib/carteira/actions.ts`),
   chamada por `criarTransacao` e pela nova `editarTransacao` antes do
   insert/update; falha na própria checagem (`error` do Supabase) não
   bloqueia o salvamento — é só um aviso auxiliar, não uma trava de
   integridade.
2. **`editarTransacao` (nova).** Livro-razão só tinha criar/excluir — faltava
   editar (Proventos já tinha esse padrão desde a seção 8.11). Mesma
   validação de venda-contra-posição-no-ponto-do-tempo de `criarTransacao`
   (seção 8.11), mas chamando `obterQuantidadeDisponivelEmData(ativoId, data,
   excluirTransacaoId)` com o novo terceiro parâmetro — sem excluir a própria
   transação sendo editada do cálculo, editar uma venda existente (mesmo sem
   mudar a quantidade) sempre acusaria "faltou quantidade" contra si mesma.
3. **Filtros no histórico: ativo e corretora com múltipla seleção, data em
   intervalo.** Decisão do Guilherme: precisa selecionar vários ativos/
   corretoras ao mesmo tempo (não um de cada vez) — implementado com
   `<select multiple>` nativo (sem lib nova, mesmo espírito "sem dependência"
   já usado em outras telas) sobre `ativos`/`livro.corretoras` já carregados.
   Como `obterLivroRazao()` já traz TODOS os lançamentos do usuário de uma
   vez (sem paginação — ver pendência #124 do backlog), os filtros são
   aplicados 100% client-side (`useMemo`), sem round-trip novo ao servidor;
   diferente do filtro de corretora da Posição (seção 8.16 item 7), que
   recalcula a posição no servidor porque ali o resultado é agregado, não uma
   lista simples.
4. **Total do filtrado: compra, venda e líquido.** Decisão do Guilherme.
   `valorCaixa(lancamento)` (novo, no componente) define o valor em caixa de
   cada transação — compra = `quantidade×preço + custos` (quanto saiu),
   venda = `quantidade×preço − custos` (quanto entrou líquido) — somado por
   tipo sobre `lancamentosFiltrados`; líquido = compra − venda. Mesma
   definição que a futura visão mensal (próxima etapa) vai reaproveitar.
5. **Seleção múltipla + exclusão em lote.** Mesmo padrão já usado em
   Proventos (seção 8.13/8.11): checkbox por linha + "selecionar todos" (dos
   lançamentos FILTRADOS, não de todos — selecionar-todos com um filtro
   ativo não deveria pegar linhas escondidas), barra de ação com confirmação
   via `ConfirmModal`. Nova `excluirTransacoesEmLote(ids[])` em
   `lib/carteira/actions.ts`, espelhando `excluirProventosEmLote`.
6. **Edição inline.** Mesmo padrão de Proventos: clicar "Editar" troca a
   linha pelo `FormTransacao` preenchido (`valoresIniciais`), no lugar de
   abrir modal/nova tela.
7. **Nuance de tipos zod: `defaultValues` precisa do tipo de ENTRADA, não de
   SAÍDA.** `transacaoSchema` tem `.transform()` em `corretora_id` (string →
   `string | null`) e `cambio` (`number | NaN` → `number | null`) — `TransacaoForm`
   (`z.infer`) é o tipo de SAÍDA (pós-transform), usado pelo que
   `criarTransacao`/`editarTransacao` recebem e pelo que `onSalvo` do form
   devolve. Mas `defaultValues`/`valoresIniciais` do `useForm` precisam do
   tipo de ENTRADA (`cambio` cru podendo ser `NaN`, não `null`) — usar
   `TransacaoForm` ali quebra a inferência do resolver do
   `@hookform/resolvers/zod`. Correção: novo `TransacaoFormInput = z.input<typeof
   transacaoSchema>`, usado só em `valoresIniciais`/`defaultValues`.
8. **`LancamentoTransacao` ganhou `corretoraId`/`cambio`.** Antes só tinha
   `corretoraNome` (pra exibir) — filtro por corretora e edição inline
   precisam do id e do câmbio original, então `obterLivroRazao()` passou a
   selecionar/expor os dois.

**Não incluído nesta rodada, registrado como próximas etapas** (ordem
combinada com o Guilherme): visão mensal de compra/venda (com corte por
classe/setor), gráfico de linha de acúmulo de capital (aporte líquido,
distinguindo venda-por-rebalanceamento de venda-com-retirada — isso exige um
jeito de capturar a INTENÇÃO da venda, que hoje não existe no schema, então
vai precisar de uma decisão de modelagem nova), eventos societários
(bonificação entra no histórico do ativo como parte do retorno; agrupamento/
desdobramento — schema novo, nenhum dos três existe hoje), importação de
transações por copiar-colar (aguardando o Guilherme mandar o modelo de
como o texto vem colado).

Arquivos tocados: `src/lib/carteira/actions.ts` (`existeTransacaoDuplicada`,
`editarTransacao`, `excluirTransacoesEmLote`, `LancamentoTransacao` com
`corretoraId`/`cambio`, `AcaoResultado` com `avisoDuplicata`),
`src/lib/ativos/actions.ts` (`obterQuantidadeDisponivelEmData` com
`excluirTransacaoId`), `src/app/(app)/carteira/LivroRazaoView.tsx`
(reescrita: filtros, total filtrado, seleção múltipla, edição inline, modal
de confirmação de duplicidade).

### 8.19 Livro-razão — visão mensal por classe + gráfico de acúmulo de capital (2026-07-20)

Segunda etapa do pedido combinado na seção 8.18 ("próximas etapas"). Escopo
desta rodada (definido pelo Guilherme na mensagem "OTIMO, AGORA VAMOS
PROSSEGUIR"): visão mensal de compra/venda por classe + gráfico de acúmulo de
capital. Eventos societários (bonificação/agrupamento/desdobramento) ficaram
só na etapa de pesquisa (seção 8.20) — a modelagem em si ainda não foi
decidida; importação por copiar-colar segue bloqueada aguardando o Guilherme
mandar o modelo.

1. **`grupo-classificacao.ts` (extração).** `ORDEM_GRUPOS`/`LABEL_GRUPO`/
   `grupoDoAtivo` viviam dentro de `lib/carteira/posicao.ts`, que tem
   `"use server"` no topo — um arquivo `"use server"` só pode exportar
   `async function` (Server Actions), então exportar dali um `const`
   array/objeto ou uma função síncrona compila limpo no `tsc` mas quebra o
   build real do Next/Vercel (mesma classe de bug da decisão 4 da seção
   8.12). Como a nova Visão mensal também precisa dessa classificação,
   extraí os três pra um módulo novo e puro, `lib/carteira/grupo-classificacao.ts`
   (sem `"use server"`), e `posicao.ts` passou a importar de lá.
   **Correção (ver §8.21): a ideia original era reexportar o TYPE
   `GrupoPosicao` também a partir de `posicao.ts` (`export type { ... }`),
   assumindo que export-de-tipo seria seguro em arquivo `"use server"` por
   ser apagado em tempo de compilação — essa suposição estava ERRADA, quebrou
   o build real do Vercel, e foi revertida.**
2. **`valorCaixaTransacao` (centralização).** A definição de "valor em caixa
   de uma transação" (compra = `quantidade×preço + custos`, venda =
   `quantidade×preço − custos`) já existia inline em `LivroRazaoView.tsx`
   (seção 8.18 item 4) e precisava ser reaproveitada pela Visão mensal —
   movida para `lib/ativos/posicao-calculo.ts` (módulo puro, sem
   `"use server"`, mesmo lugar de `calcularPosicao`/`aplicarTransacaoNaPosicao`)
   como `valorCaixaTransacao(t: TransacaoCalc)`. `LivroRazaoView.tsx` e
   `lib/carteira/visao-mensal.ts` importam a mesma função — fonte única,
   nenhuma fórmula duplicada entre as duas telas.
3. **Visão mensal — formato (réplica do print do Guilherme).** Nova
   `lib/carteira/visao-mensal.ts` (`"use server"`, função `obterVisaoMensal()`)
   agrega todas as transações do usuário em duas formas simultâneas: uma
   seção "GERAL" (cada mês-calendário — Jan...Dez — somado através de TODOS
   os anos) seguida de uma seção por ano (mesmo detalhamento, só daquele
   ano, mais recente primeiro), cada uma com linhas Compra/Venda/Líquido e
   coluna de Total. O mesmo par (GERAL + por-ano) é calculado três vezes:
   uma para o total geral da carteira, e uma para cada classe/grupo (mesma
   classificação `GrupoPosicao` da sub-aba Posição — Ações, FIIs, Tesouro
   etc.), permitindo o corte por classe pedido pelo Guilherme.
4. **UI da Visão mensal — carregamento sob demanda.** `VisaoMensalView.tsx`
   (novo, `"use client"`) só busca `obterVisaoMensal()` no `useEffect` de
   montagem — o componente inteiro só é renderizado (e portanto só busca
   dados) quando o Guilherme clica no botão "Visão mensal" dentro do
   Livro-razão, evitando pagar o custo dessa agregação pesada (todo o
   histórico de transações) em toda visita à aba. Cada classe aparece como
   seção retrátil (accordion, mesmo padrão visual de `PosicaoView.tsx`),
   mas começando FECHADA por padrão — diferente da Posição, aqui cada
   classe pode conter vários anos de sub-tabelas, então abrir tudo de cara
   poluiria a tela.
5. **Gráfico de acúmulo de capital — regra de retirada (decisão do
   Guilherme).** Pedido: distinguir uma venda de rebalanceamento (dinheiro
   continua na carteira, só mudou de ativo) de uma venda com retirada
   (dinheiro saiu da carteira) — informação que não existe explicitamente
   no schema. Regra definida pelo Guilherme, verbatim: "QUANDO O MES TIVER
   A VENDA MAIOR QUE O APORTE... QUE DIZER QUE EU RETIREI [a diferença]".
   Implementada em `construirEvolucaoCapital()`: por mês-calendário,
   `liquido = compra − venda` (pode ser negativo) e
   `retirada = Math.max(0, venda − compra)`; `acumulado` é a soma corrida
   de `liquido` mês a mês (isso é o que o gráfico de linha desenha —
   `retirada` é só um insight complementar mostrado ao lado, não afeta o
   acumulado por si só, já que `liquido` já contempla a mesma subtração).
   Não precisou de nenhuma coluna nova no banco — é 100% derivado de
   `transacoes` (mesma fonte única de sempre).
6. **Gráfico — componente reaproveitado.** `SerieLinhaChart` (SVG próprio,
   já usado em Indicadores/histórico de preço) reutilizado para o gráfico
   de "Acúmulo de capital" em vez de introduzir Recharts (já instalado,
   seção 8.14) ou escrever SVG novo — mesmo padrão de reaproveitamento do
   resto do app.

Arquivos criados: `src/lib/carteira/grupo-classificacao.ts`,
`src/lib/carteira/visao-mensal.ts`,
`src/app/(app)/carteira/VisaoMensalView.tsx`. Arquivos editados:
`src/lib/carteira/posicao.ts` (import de `grupo-classificacao.ts` em vez de
definição inline), `src/lib/ativos/posicao-calculo.ts`
(`valorCaixaTransacao` nova), `src/app/(app)/carteira/LivroRazaoView.tsx`
(botão "Visão mensal", total filtrado agora usa `valorCaixaTransacao`
importado em vez do antigo helper local `valorCaixa`).

### 8.20 Eventos societários (bonificação/desdobramento/grupamento) — pesquisa B3/CVM (2026-07-20)

Pedido do Guilherme: "PRECISO QUE ESTUDE, LEIA TUDO SOBRE ISSO COMO A B3 AS
CLASSIFICA, COMO A CVM FALA SOBRE" antes de desenhar qualquer schema.
Resumo do levantado (fontes: InfoMoney, portal oficial do investidor
gov.br/CVM):

- **Desdobramento (split).** Quantidade de ações aumenta, preço cai na
  mesma proporção, valor total da posição não muda. Não é fato gerador de
  IR (não é considerado alienação nem rendimento) — é só um reajuste de
  proporção. Exige aprovação em assembleia + comunicação à CVM via Fato
  Relevante.
- **Grupamento (inplit/reverse split).** Oposto do desdobramento —
  quantidade cai, preço sobe na mesma proporção, valor total não muda. A
  B3 pode exigir grupamento compulsório de uma ação que fica com cotação
  abaixo de R$1,00 por mais de um mês corrido. Mesmo tratamento de IR do
  desdobramento (não é fato gerador).
- **Bonificação.** A empresa capitaliza lucro/reservas e distribui ações
  novas sem desembolso do acionista. Para IR, é classificada como
  "rendimento isento" (declarado sob o código 18, "Rendimentos Isentos e
  Não Tributáveis" — não é dividendo, mas também não gera imposto na
  distribuição em si). PORÉM sempre carrega um custo de aquisição: ou o
  valor que a empresa atribuiu à reserva capitalizada, ou zero (quando não
  há valor capitalizado atribuído, caso que se comporta como um split).
  Na prática, corretoras costumam redistribuir o custo médio já existente
  entre as ações antigas + as novas bonificadas (efeito líquido: mesmo
  custo total, mais ações) — nunca é correto tratar as ações bonificadas
  como "custo zero" isoladamente pra fins de apuração de ganho de capital
  na venda; o que entra no cálculo é o custo médio ponderado ajustado.

**Decisão de modelagem ainda em aberto** — não avançar pra esquema de banco
sem antes perguntar ao Guilherme (protocolo da seção 1): schema novo tipo
"eventos societários" (tabela separada, efeito calculado à parte) vs.
tratar como um tipo especial de `transacao` com efeito automático no
cálculo de posição. Essa pergunta fica pra próxima rodada de trabalho.

### 8.21 Correção de build: `export type` também quebra em arquivo `"use server"` (2026-07-20)

Achado real no deploy do Vercel logo após a §8.19 (não pego pelo `tsc
--noEmit` nem por nenhuma checagem disponível neste sandbox — só apareceu no
log do build do Vercel):

```
Error: Turbopack build failed with 1 errors:
Export GrupoPosicao doesn't exist in target module
The export GrupoPosicao was not found in module .../lib/carteira/posicao.ts
```

**Causa.** `lib/carteira/posicao.ts` (`"use server"`) tinha
`export type { GrupoPosicao };` pra não quebrar quem já importava esse tipo
dali (decisão original da §8.19, item 1) — a suposição era que um export
*só de tipo* seria seguro num arquivo `"use server"` porque tipos são
apagados em tempo de compilação. Na prática, o transform de Server Actions
do Next/Turbopack escaneia **todo** export do arquivo (não distingue
export de tipo de export de valor) pra montar o módulo interno de
referências de ações (`.next-internal/.../actions.js`) — como o `type`
não existe em tempo de execução, o módulo gerado referencia um export que
não existe, e o build (não o `tsc`) falha. Essa é uma checagem exclusiva do
bundler do Next, igual à decisão 4 da §8.12 (funções síncronas em arquivo
`"use server"`) — outra categoria de bug que `tsc --noEmit`/eslint não
enxergam neste ambiente por falta de acesso de rede pra rodar o `next
build` de verdade.

**Correção.** Removido `export type { GrupoPosicao }` de
`lib/carteira/posicao.ts` — nenhum export além de `async function` e
`type`/`const` NÃO-tipo... na real, a regra segura agora é: **um arquivo
`"use server"` só deve exportar `async function`s (Server Actions de
verdade)**; até `export type` deve ser evitado ali. Quem precisa do tipo
`GrupoPosicao` (só `PosicaoView.tsx`) passou a importar direto de
`lib/carteira/grupo-classificacao.ts` (o módulo puro, sem `"use server"`,
onde o tipo é definido) em vez de reexportado por `posicao.ts`.

**Lição pro futuro (atualiza a decisão 4 da §8.12):** ao extrair algo de um
arquivo `"use server"`, não deixar NENHUM `export` de conveniência lá
atrás — nem tipo — se o único motivo for compatibilidade de import. Sempre
apontar os importadores pro módulo puro novo diretamente. E como isso só
aparece no build real (Vercel), depois de qualquer mudança estrutural em
arquivo `"use server"` vale a pena revisar rapidamente se sobrou algum
export que não seja `async function`.

Arquivos tocados: `src/lib/carteira/posicao.ts` (removido
`export type { GrupoPosicao }`), `src/app/(app)/carteira/PosicaoView.tsx`
(import de `GrupoPosicao` trocado de `@/lib/carteira/posicao` para
`@/lib/carteira/grupo-classificacao`).

**Segunda ocorrência do mesmo bug, achada na auditoria pós-fix.** Ao revisar
`lib/carteira/visao-mensal.ts` (também `"use server"`), achamos um caso
ainda mais óbvio do mesmo problema: o arquivo exportava
`export const MESES_LABEL = [...]` (uma constante de verdade, nem tipo) e
seis `export type` (`MesDado`, `LinhaTabelaMensal`, `TabelaMensal`,
`GrupoVisaoMensal`, `PontoCapitalMensal`, `VisaoMensal`) — `MESES_LABEL`
sendo uma const exportada de um arquivo `"use server"` é exatamente a
decisão 4 da §8.12 (só `async function` pode ser exportado dali), e por
segurança os tipos foram junto. Correção: criado
`lib/carteira/visao-mensal-tipos.ts` (módulo puro, sem `"use server"`) com
`MESES_LABEL` + todos os tipos; `visao-mensal.ts` agora só importa deles
internamente e exporta unicamente `obterVisaoMensal` (async function).
`VisaoMensalView.tsx` importa `obterVisaoMensal` de `visao-mensal.ts` e
`MESES_LABEL`/tipos de `visao-mensal-tipos.ts` diretamente.

**Nota sobre o alcance desta correção:** uma auditoria em todos os 16
arquivos `"use server"` do projeto mostrou que a maioria (`lib/ativos/actions.ts`,
`lib/carteira/actions.ts`, `lib/ir/actions.ts`, `lib/proventos/actions.ts`
etc.) também tem `export type X = {...}` LOCAL (tipo definido no próprio
arquivo, não reexportado de outro módulo) ao lado das Server Actions — e
esses arquivos já buildam/deployam sem problema há muitas rodadas
(histórico de tasks #1–#163 já em produção). Ou seja, a causa real
comprovada do erro de build é mais específica que "todo `export type` quebra":
é (a) exportar uma constante/valor de verdade que não é `async function`
(caso do `MESES_LABEL`), e/ou (b) reexportar um tipo IMPORTADO de outro
módulo via `export type { X }` sem `type X = ...` local (caso do
`GrupoPosicao`). Tipos definidos localmente com `export type X = {...}`
dentro do próprio arquivo `"use server"`, ao lado de Server Actions,
parecem seguros na prática (padrão já usado em todo o resto do app) — por
isso NÃO mexemos nos outros 15 arquivos além destes dois; seria
refatoração especulativa fora do escopo pedido, e o padrão já em produção
nesses arquivos nunca causou o erro visto aqui.

Arquivos tocados (2ª ocorrência): `src/lib/carteira/visao-mensal-tipos.ts`
(novo), `src/lib/carteira/visao-mensal.ts` (só `obterVisaoMensal` exportado),
`src/app/(app)/carteira/VisaoMensalView.tsx` (imports ajustados).

## 9. Convenções a preservar

- Toda action em arquivo `"use server"` precisa ser **async** mesmo que não
  faça `await` (Next exige; funções auxiliares internas não-exportadas ficam
  de fora dessa regra).
- Validação de formulário com Zod em `schema.ts` ao lado de cada `actions.ts`.
- Nomes de campos/variáveis em português (`ticker`, `peso_alvo`,
  `valorAtual`), consistente em banco, actions e UI — não misturar idiomas
  em nomes novos.
- Preço é informado manualmente pra `renda_fixa`/`fundo`/`outro`. Pros
  demais tipos (`acao`, `fii`, `etf`, `internacional`, `cripto`) o preço
  pode vir do cron/botão de cotação automática (Yahoo Finance, ver seção
  8.10) — qualquer feature que assuma preço "ao vivo" precisa checar
  `preco_atualizado_em` e `preco_fonte` antes de confiar no valor, já que
  a fonte não-oficial pode falhar e deixar o valor desatualizado.
