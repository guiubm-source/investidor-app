-- ============================================================================
-- Schema: autenticação + cadastro do investidor + Ativos + Alocação + Carteira
-- Rode este script inteiro no Supabase Dashboard > SQL Editor > New query
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. PROFILES — dados pessoais do usuário (1 linha por usuário autenticado)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text,
  cpf           text unique,
  birth_date    date,
  phone         text,
  cadastro_completo boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is 'Dados pessoais do investidor, 1 linha por usuário.';

-- ----------------------------------------------------------------------------
-- 2. INVESTOR_SUITABILITY — histórico do questionário de perfil (API/suitability)
--    Cada preenchimento gera uma NOVA linha (não sobrescreve), preservando o
--    histórico exigido para fins de compliance (CVM Resolução 30 / regras B3).
-- ----------------------------------------------------------------------------
create table if not exists public.investor_suitability (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references public.profiles (id) on delete cascade,

  -- Objetivos e horizonte
  objetivo_investimento text not null
    check (objetivo_investimento in ('preservacao_capital','geracao_renda','crescimento_patrimonio','especulacao')),
  horizonte_investimento text not null
    check (horizonte_investimento in ('curto_prazo','medio_prazo','longo_prazo')),
  necessidade_liquidez text not null
    check (necessidade_liquidez in ('imediata','ate_1_ano','sem_necessidade')),

  -- Situação financeira
  renda_mensal numeric(14,2) not null check (renda_mensal >= 0),
  patrimonio_total numeric(14,2) not null check (patrimonio_total >= 0),
  percentual_patrimonio_a_investir numeric(5,2) check (percentual_patrimonio_a_investir between 0 and 100),

  -- Conhecimento e experiência
  conhecimento_mercado text not null
    check (conhecimento_mercado in ('nenhum','basico','intermediario','avancado')),
  experiencia_renda_fixa text not null
    check (experiencia_renda_fixa in ('nenhuma','pouca','moderada','ampla')),
  experiencia_fundos text not null
    check (experiencia_fundos in ('nenhuma','pouca','moderada','ampla')),
  experiencia_acoes text not null
    check (experiencia_acoes in ('nenhuma','pouca','moderada','ampla')),
  experiencia_derivativos text not null
    check (experiencia_derivativos in ('nenhuma','pouca','moderada','ampla')),

  -- Tolerância a risco
  tolerancia_perda text not null
    check (tolerancia_perda in ('baixa','media','alta')),
  percentual_perda_aceitavel numeric(5,2) check (percentual_perda_aceitavel between 0 and 100),
  reacao_a_perda text not null
    check (reacao_a_perda in ('venderia_tudo','venderia_parte','manteria','compraria_mais')),

  -- Resultado calculado (ver src/lib/suitability/score.ts)
  score integer not null check (score >= 0),
  perfil_resultado text not null
    check (perfil_resultado in ('conservador','moderado','arrojado')),

  created_at timestamptz not null default now()
);

comment on table public.investor_suitability is 'Histórico do questionário de suitability (análise de perfil do investidor). Nunca é atualizado, só recebe novas linhas.';

create index if not exists idx_investor_suitability_profile_id_created_at
  on public.investor_suitability (profile_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 3. VIEW de conveniência: perfil de suitability mais recente de cada usuário
-- ----------------------------------------------------------------------------
create or replace view public.current_investor_suitability as
select distinct on (profile_id) *
from public.investor_suitability
order by profile_id, created_at desc;

-- ----------------------------------------------------------------------------
-- 4. updated_at automático
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Criação automática de profile ao cadastrar um novo usuário (auth.users)
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 6. RLS (Row Level Security) — cada usuário só acessa os próprios dados
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.investor_suitability enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Insert em profiles é feito pelo trigger (security definer); usuários comuns
-- não precisam de policy de insert direta, mas deixamos uma por segurança
-- caso algum fluxo futuro precise inserir manualmente.
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "suitability_select_own" on public.investor_suitability;
create policy "suitability_select_own" on public.investor_suitability
  for select using (auth.uid() = profile_id);

drop policy if exists "suitability_insert_own" on public.investor_suitability;
create policy "suitability_insert_own" on public.investor_suitability
  for insert with check (auth.uid() = profile_id);

-- Sem policy de update/delete em investor_suitability de propósito:
-- o histórico é imutável (compliance). Uma nova resposta = nova linha.

-- ============================================================================
-- 7. ALOCAÇÃO — estrutura-alvo em 2 camadas (classe > setor). Define o MODELO
--    de carteira desejado, independente de quais ativos você possui.
--    profile_id é repetido (denormalizado) de propósito: simplifica e acelera
--    as políticas de RLS, evitando joins/subqueries.
-- ============================================================================

-- 7.1 Classes de ativo (Renda Fixa, Ações, FIIs, etc.) — peso-alvo somando
--     100% do patrimônio total do usuário.
create table if not exists public.alocacao_classes (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  nome        text not null,
  peso_alvo   numeric(5,2) not null check (peso_alvo between 0 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, nome)
);

comment on table public.alocacao_classes is 'Nível 1 da estrutura-alvo: classes de ativo (ex. Renda Fixa, Ações, FIIs).';

-- 7.2 Setores/segmentos dentro de uma classe (ex. dentro de Ações: Financeiro,
--     Tecnologia; dentro de FIIs: Lajes Corporativas, Logística) — peso-alvo
--     somando 100% daquela classe.
create table if not exists public.alocacao_setores (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  classe_id   uuid not null references public.alocacao_classes (id) on delete cascade,
  nome        text not null,
  peso_alvo   numeric(5,2) not null check (peso_alvo between 0 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (classe_id, nome)
);

comment on table public.alocacao_setores is 'Nível 2 da estrutura-alvo: setor ou segmento dentro de uma classe.';

create index if not exists idx_alocacao_setores_classe_id on public.alocacao_setores (classe_id);

-- updated_at automático
drop trigger if exists trg_alocacao_classes_updated_at on public.alocacao_classes;
create trigger trg_alocacao_classes_updated_at
  before update on public.alocacao_classes
  for each row execute function public.set_updated_at();

drop trigger if exists trg_alocacao_setores_updated_at on public.alocacao_setores;
create trigger trg_alocacao_setores_updated_at
  before update on public.alocacao_setores
  for each row execute function public.set_updated_at();

-- RLS
alter table public.alocacao_classes enable row level security;
alter table public.alocacao_setores enable row level security;

drop policy if exists "alocacao_classes_all_own" on public.alocacao_classes;
create policy "alocacao_classes_all_own" on public.alocacao_classes
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "alocacao_setores_all_own" on public.alocacao_setores;
create policy "alocacao_setores_all_own" on public.alocacao_setores
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- ============================================================================
-- 8. ATIVOS — registro mestre dos investimentos individuais. É o "motor
--    central" do app: identidade (ticker/tipo), classificação (setor, que já
--    carrega a classe) e peso-alvo dentro do setor moram AQUI, e em nenhum
--    outro lugar — Alocação e Carteira só leem esses dados, nunca duplicam.
--    `setor_id`/`peso_alvo` nulos = ativo ainda não classificado.
--    `preco_atual` é informado manualmente (sem API de cotação);
--    `preco_atualizado_em` guarda quando foi a última vez que isso foi feito.
--    `simbolo_tradingview` é o símbolo usado no gráfico embutido (ex.
--    BMFBOVESPA:ITSA3); se nulo, o app deriva um padrão a partir do tipo.
-- ============================================================================
create table if not exists public.ativos (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  ticker       text not null,
  nome         text,
  tipo         text not null
    check (tipo in ('acao','fii','renda_fixa','fundo','internacional','cripto','outro')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (profile_id, ticker)
);

comment on table public.ativos is 'Registro mestre de ativos: identidade, classificação (setor) e peso-alvo. Fonte única de verdade para Alocação e Carteira.';

-- `create table if not exists` acima não altera uma tabela `ativos` que já
-- existia de uma versão anterior do schema — por isso as colunas novas (e a
-- remoção da antiga `valor_atual`) precisam de ALTER TABLE explícito abaixo,
-- seguro de rodar de novo quantas vezes for preciso.
alter table public.ativos drop column if exists valor_atual;
alter table public.ativos add column if not exists setor_id uuid references public.alocacao_setores (id) on delete set null;
alter table public.ativos add column if not exists peso_alvo numeric(5,2) check (peso_alvo between 0 and 100);
alter table public.ativos add column if not exists preco_atual numeric(14,4) not null default 0 check (preco_atual >= 0);
alter table public.ativos add column if not exists preco_atualizado_em timestamptz;
alter table public.ativos add column if not exists simbolo_tradingview text;

-- Campos usados só pelo relatório de Imposto de Renda (aba Indicadores/IR,
-- ver docs/MAPA-DE-DADOS.md §8.5). Nulos = ainda não informado; sem efeito
-- em nenhum outro cálculo do app (posição, alocação, etc.) além do IR.
alter table public.ativos add column if not exists subtipo_renda_fixa text
  check (subtipo_renda_fixa in ('cdb','tesouro','debenture','lci','lca','cri','cra'));
alter table public.ativos add column if not exists cripto_exchange text
  check (cripto_exchange in ('nacional','estrangeira'));

create index if not exists idx_ativos_setor_id on public.ativos (setor_id);

drop trigger if exists trg_ativos_updated_at on public.ativos;
create trigger trg_ativos_updated_at
  before update on public.ativos
  for each row execute function public.set_updated_at();

alter table public.ativos enable row level security;

drop policy if exists "ativos_all_own" on public.ativos;
create policy "ativos_all_own" on public.ativos
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- Tabela antiga (nível 3 da alocação-alvo), substituída pelas colunas
-- setor_id/peso_alvo diretamente em `ativos` — elimina a duplicidade entre
-- "classificação do ativo" e "peso-alvo", que antes viviam em lugares
-- diferentes para a mesma informação.
drop table if exists public.alocacao_ativos;

-- ============================================================================
-- 9. CARTEIRA — livro-razão de lançamentos (compra/venda/proventos). A
--    quantidade e o preço médio de cada ativo são CALCULADOS a partir daqui
--    (método do custo médio ponderado, padrão no Brasil inclusive para
--    apuração de IR sobre renda variável) — nunca armazenados diretamente.
-- ============================================================================

-- 9.1 Corretoras — registro simples de onde cada posição está custodiada.
create table if not exists public.corretoras (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  nome        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, nome)
);

comment on table public.corretoras is 'Corretoras/instituições onde o investidor mantém ativos custodiados.';

-- 9.2 Transações — cada compra/venda lançada pelo usuário.
create table if not exists public.transacoes (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  ativo_id       uuid not null references public.ativos (id) on delete cascade,
  corretora_id   uuid references public.corretoras (id) on delete set null,
  tipo           text not null check (tipo in ('compra','venda')),
  data           date not null,
  quantidade     numeric(18,8) not null check (quantidade > 0),
  preco_unitario numeric(14,4) not null check (preco_unitario >= 0),
  custos         numeric(14,2) not null default 0 check (custos >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Câmbio do dia da operação — só relevante para ativos.tipo = 'internacional'
-- (apuração de ganho de capital em Lei 14.754/2023 usa câmbio da compra e da
-- venda). Nulo para todo o resto (ver docs/MAPA-DE-DADOS.md §8.5.4).
alter table public.transacoes add column if not exists cambio numeric(10,4) check (cambio > 0);

comment on table public.transacoes is 'Lançamentos de compra/venda por ativo. Base para cálculo de quantidade, preço médio (custo médio ponderado) e lucro realizado.';

create index if not exists idx_transacoes_ativo_id_data on public.transacoes (ativo_id, data);

-- 9.3 Proventos — dividendos, JCP e rendimentos recebidos por ativo.
create table if not exists public.proventos (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  ativo_id    uuid not null references public.ativos (id) on delete cascade,
  tipo        text not null check (tipo in ('dividendo','jcp','rendimento','outro')),
  data        date not null,
  valor_total numeric(14,2) not null check (valor_total >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.proventos is 'Proventos (dividendos, JCP, rendimentos) recebidos por ativo — usados no cálculo de retorno total.';

create index if not exists idx_proventos_ativo_id_data on public.proventos (ativo_id, data);

-- updated_at automático nas tabelas novas
drop trigger if exists trg_corretoras_updated_at on public.corretoras;
create trigger trg_corretoras_updated_at
  before update on public.corretoras
  for each row execute function public.set_updated_at();

drop trigger if exists trg_transacoes_updated_at on public.transacoes;
create trigger trg_transacoes_updated_at
  before update on public.transacoes
  for each row execute function public.set_updated_at();

drop trigger if exists trg_proventos_updated_at on public.proventos;
create trigger trg_proventos_updated_at
  before update on public.proventos
  for each row execute function public.set_updated_at();

-- RLS
alter table public.corretoras enable row level security;
alter table public.transacoes enable row level security;
alter table public.proventos enable row level security;

drop policy if exists "corretoras_all_own" on public.corretoras;
create policy "corretoras_all_own" on public.corretoras
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "transacoes_all_own" on public.transacoes;
create policy "transacoes_all_own" on public.transacoes
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "proventos_all_own" on public.proventos;
create policy "proventos_all_own" on public.proventos
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- ============================================================================
-- 10. INDICADORES — Selic, IPCA, Dólar e Fluxo estrangeiro (macro, aba
--     Indicadores). DIFERENTE de toda tabela anterior: são dados OFICIAIS,
--     iguais para qualquer usuário do app — por isso, DE PROPÓSITO, essas
--     tabelas NÃO têm `profile_id` e não seguem RLS por dono da linha (ver
--     docs/MAPA-DE-DADOS.md seção 8.3.8). Qualquer usuário autenticado lê e
--     escreve o mesmo registro compartilhado. Cadastro é sempre manual
--     (decisão consciente de não integrar a API gratuita do BACEN/SGS por
--     enquanto — ver seção 8.3.2 do mapa). Reavaliar RLS se o app deixar de
--     ser de uso pessoal.
-- ============================================================================

-- 10.1 Selic — log de reuniões do Copom (8x/ano, a cada ~45 dias, 2 dias
--      consecutivos). Datas de 2026 já públicas vêm pré-cadastradas (seed
--      abaixo); `taxa_definida` fica nula até a decisão sair.
create table if not exists public.indicador_selic_reunioes (
  id             uuid primary key default gen_random_uuid(),
  data_inicio    date not null,
  data_fim       date not null,
  taxa_definida  numeric(6,2) check (taxa_definida >= 0),
  decidido_em    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (data_inicio)
);

comment on table public.indicador_selic_reunioes is 'Log de reuniões do Copom (dado compartilhado, sem profile_id). taxa_definida nula = reunião ainda não aconteceu.';

drop trigger if exists trg_indicador_selic_reunioes_updated_at on public.indicador_selic_reunioes;
create trigger trg_indicador_selic_reunioes_updated_at
  before update on public.indicador_selic_reunioes
  for each row execute function public.set_updated_at();

-- Seed: calendário 2026 já público (fonte: Banco Central). Idempotente via
-- ON CONFLICT — pode rodar de novo sem duplicar nem sobrescrever taxa já
-- lançada manualmente.
insert into public.indicador_selic_reunioes (data_inicio, data_fim) values
  ('2026-03-17', '2026-03-18'),
  ('2026-04-28', '2026-04-29'),
  ('2026-06-16', '2026-06-17'),
  ('2026-08-04', '2026-08-05'),
  ('2026-09-15', '2026-09-16'),
  ('2026-11-03', '2026-11-04'),
  ('2026-12-08', '2026-12-09')
on conflict (data_inicio) do nothing;

-- 10.2 IPCA — consolidado mensal + acumulado 12 meses (meta contínua desde
--      2025, não mais por ano-calendário).
create table if not exists public.indicador_ipca_mensal (
  id                 uuid primary key default gen_random_uuid(),
  ano_mes            text not null unique check (ano_mes ~ '^\d{4}-\d{2}$'),
  variacao_pct       numeric(6,3) not null,
  acumulado_12m_pct  numeric(6,3),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.indicador_ipca_mensal is 'IPCA consolidado por mês (ano_mes formato YYYY-MM) e acumulado em 12 meses, para conferir enquadramento na meta contínua.';

drop trigger if exists trg_indicador_ipca_mensal_updated_at on public.indicador_ipca_mensal;
create trigger trg_indicador_ipca_mensal_updated_at
  before update on public.indicador_ipca_mensal
  for each row execute function public.set_updated_at();

-- 10.3 IPCA por categoria — os 9 grupos oficiais do IBGE, um lançamento por
--      mês/categoria. Ligação com indicador_ipca_mensal é só por convenção
--      de ano_mes (não FK de banco) — um mês pode ter só o consolidado
--      lançado ainda sem detalhamento por categoria.
create table if not exists public.indicador_ipca_categoria (
  id            uuid primary key default gen_random_uuid(),
  ano_mes       text not null check (ano_mes ~ '^\d{4}-\d{2}$'),
  categoria     text not null check (categoria in (
    'alimentacao_bebidas', 'habitacao', 'artigos_residencia', 'vestuario',
    'transportes', 'saude_cuidados_pessoais', 'despesas_pessoais',
    'educacao', 'comunicacao'
  )),
  variacao_pct  numeric(6,3) not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (ano_mes, categoria)
);

comment on table public.indicador_ipca_categoria is 'IPCA por grupo IBGE (9 categorias oficiais), um valor por mês/categoria.';

drop trigger if exists trg_indicador_ipca_categoria_updated_at on public.indicador_ipca_categoria;
create trigger trg_indicador_ipca_categoria_updated_at
  before update on public.indicador_ipca_categoria
  for each row execute function public.set_updated_at();

-- 10.4 Dólar — cotação mensal (fechamento/média do mês, decidido na UI).
create table if not exists public.indicador_dolar_mensal (
  id          uuid primary key default gen_random_uuid(),
  ano_mes     text not null unique check (ano_mes ~ '^\d{4}-\d{2}$'),
  cotacao     numeric(10,4) not null check (cotacao > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.indicador_dolar_mensal is 'Cotação do dólar (PTAX ou equivalente), um valor por mês.';

drop trigger if exists trg_indicador_dolar_mensal_updated_at on public.indicador_dolar_mensal;
create trigger trg_indicador_dolar_mensal_updated_at
  before update on public.indicador_dolar_mensal
  for each row execute function public.set_updated_at();

-- 10.5 Fluxo estrangeiro — saldo líquido mensal (B3), pode ser negativo.
create table if not exists public.indicador_fluxo_estrangeiro_mensal (
  id             uuid primary key default gen_random_uuid(),
  ano_mes        text not null unique check (ano_mes ~ '^\d{4}-\d{2}$'),
  saldo_liquido  numeric(16,2) not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.indicador_fluxo_estrangeiro_mensal is 'Saldo líquido mensal de fluxo de capital estrangeiro na B3 (R$, pode ser negativo = saída).';

drop trigger if exists trg_indicador_fluxo_estrangeiro_mensal_updated_at on public.indicador_fluxo_estrangeiro_mensal;
create trigger trg_indicador_fluxo_estrangeiro_mensal_updated_at
  before update on public.indicador_fluxo_estrangeiro_mensal
  for each row execute function public.set_updated_at();

-- RLS: qualquer usuário autenticado lê e escreve (dado compartilhado, sem
-- profile_id — ver comentário no topo da seção 10).
alter table public.indicador_selic_reunioes enable row level security;
alter table public.indicador_ipca_mensal enable row level security;
alter table public.indicador_ipca_categoria enable row level security;
alter table public.indicador_dolar_mensal enable row level security;
alter table public.indicador_fluxo_estrangeiro_mensal enable row level security;

drop policy if exists "indicador_selic_reunioes_authenticated" on public.indicador_selic_reunioes;
create policy "indicador_selic_reunioes_authenticated" on public.indicador_selic_reunioes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "indicador_ipca_mensal_authenticated" on public.indicador_ipca_mensal;
create policy "indicador_ipca_mensal_authenticated" on public.indicador_ipca_mensal
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "indicador_ipca_categoria_authenticated" on public.indicador_ipca_categoria;
create policy "indicador_ipca_categoria_authenticated" on public.indicador_ipca_categoria
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "indicador_dolar_mensal_authenticated" on public.indicador_dolar_mensal;
create policy "indicador_dolar_mensal_authenticated" on public.indicador_dolar_mensal
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "indicador_fluxo_estrangeiro_mensal_authenticated" on public.indicador_fluxo_estrangeiro_mensal;
create policy "indicador_fluxo_estrangeiro_mensal_authenticated" on public.indicador_fluxo_estrangeiro_mensal
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================================
-- 11. Selic avançada (numeração oficial da reunião) + cadastros de
--     referência (diretoria do Bacen, presidentes do Brasil) — decisões em
--     docs/MAPA-DE-DADOS.md §8.7 (2026-07-14). bacen_diretoria e
--     brasil_presidentes seguem o mesmo padrão de dado compartilhado da
--     seção 10 (sem profile_id, RLS auth.role() = 'authenticated') — são
--     cadastrados em Configurações, mas lidos pela aba Indicadores (Selic
--     hoje, IPCA depois) para os filtros de mandato do gráfico.
-- ============================================================================

-- 11.1 Numeração oficial da reunião do Copom ("277ª reunião"). Não dá pra
--      derivar contando linhas (numeração oficial começa em 1996 e o app
--      pode não ter o histórico completo carregado) — por isso é campo
--      próprio, preenchido via importação ou lançamento manual.
alter table public.indicador_selic_reunioes add column if not exists numero_reuniao integer;

create unique index if not exists indicador_selic_reunioes_numero_reuniao_key
  on public.indicador_selic_reunioes (numero_reuniao)
  where numero_reuniao is not null;

-- 11.2 Diretoria do Banco Central — histórico completo (presidente +
--      diretores), todos os mandatos. `presidente` é uma flag separada do
--      texto livre de `cargo` (que muda de nome ao longo das décadas) pra
--      identificar com certeza qual linha é presidência, sem parsear texto.
create table if not exists public.bacen_diretoria (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  cargo           text not null,
  presidente      boolean not null default false,
  mandato_inicio  date not null,
  mandato_fim     date,
  nomeado_por     text,
  data_posse      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (mandato_fim is null or mandato_fim >= mandato_inicio)
);

comment on table public.bacen_diretoria is 'Diretoria completa do Bacen (presidente + diretores), todos os mandatos históricos. Dado compartilhado, sem profile_id — cadastrado em Configurações, lido pelos filtros de mandato da aba Indicadores.';

drop trigger if exists trg_bacen_diretoria_updated_at on public.bacen_diretoria;
create trigger trg_bacen_diretoria_updated_at
  before update on public.bacen_diretoria
  for each row execute function public.set_updated_at();

-- 11.3 Presidentes do Brasil — usado no filtro "mandato presidencial" do
--      gráfico de evolução da Selic (e futuramente do IPCA).
create table if not exists public.brasil_presidentes (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  mandato_inicio  date not null,
  mandato_fim     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (mandato_fim is null or mandato_fim >= mandato_inicio)
);

comment on table public.brasil_presidentes is 'Presidentes do Brasil e período de mandato. Dado compartilhado, sem profile_id — cadastrado em Configurações, lido pelos filtros de mandato da aba Indicadores.';

drop trigger if exists trg_brasil_presidentes_updated_at on public.brasil_presidentes;
create trigger trg_brasil_presidentes_updated_at
  before update on public.brasil_presidentes
  for each row execute function public.set_updated_at();

alter table public.bacen_diretoria enable row level security;
alter table public.brasil_presidentes enable row level security;

drop policy if exists "bacen_diretoria_authenticated" on public.bacen_diretoria;
create policy "bacen_diretoria_authenticated" on public.bacen_diretoria
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "brasil_presidentes_authenticated" on public.brasil_presidentes;
create policy "brasil_presidentes_authenticated" on public.brasil_presidentes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
