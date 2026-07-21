"use client";

/**
 * Questionário inicial de IR (§8.32.12) — fase 1 da reformulação (fundação
 * fiscal, ver docs/MAPA-DE-DADOS.md §8.33). Só pergunta o que já tem tabela
 * própria (`ir_perfis_fiscais`); as demais perguntas do questionário
 * completo do doc entram junto dos módulos manuais correspondentes em
 * fases futuras.
 */

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { perfilFiscalSchema, type PerfilFiscalFormInput } from "@/lib/ir/schema";
import { salvarPerfilFiscalIR } from "@/lib/ir/actions";
import { useToast } from "@/components/ToastProvider";

type Props = {
  declaracaoId: string;
  valoresIniciais?: Partial<PerfilFiscalFormInput>;
  onSalvo: () => void;
};

const DEFAULTS: PerfilFiscalFormInput = {
  residente_brasil: true,
  residente_desde: "",
  saida_definitiva: false,
  us_person: false,
  cidadania_eua: false,
  green_card: false,
  nonresident_alien: true,
  dias_presenca_eua: "",
  possui_dependentes: false,
  declaracao_conjunta: false,
  possui_trust: false,
  possui_controlada_exterior: false,
};

function Toggle({
  label,
  descricao,
  ...props
}: { label: string; descricao?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-start gap-3 py-2 cursor-pointer">
      <input type="checkbox" className="mt-0.5 h-4 w-4" {...props} />
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {descricao && <span className="block text-xs text-faint">{descricao}</span>}
      </span>
    </label>
  );
}

export default function QuestionarioIR({ declaracaoId, valoresIniciais, onSalvo }: Props) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = useForm({
    resolver: zodResolver(perfilFiscalSchema),
    defaultValues: { ...DEFAULTS, ...valoresIniciais },
  });
  const toast = useToast();

  const residenteBrasil = watch("residente_brasil");
  const usPersonOuSimilar = watch("us_person") || watch("cidadania_eua") || watch("green_card");
  const foraEscopo =
    watch("possui_dependentes") || watch("declaracao_conjunta") || watch("possui_trust") || watch("possui_controlada_exterior");

  const onSubmit = handleSubmit(async (dados) => {
    try {
      const resultado = await salvarPerfilFiscalIR(declaracaoId, dados);
      if (resultado.error) throw new Error(resultado.error);
      toast.success("Perfil fiscal salvo.");
      onSalvo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar o questionário.");
    }
  });

  return (
    <form onSubmit={onSubmit} className="card p-5 space-y-6">
      <div>
        <h3 className="text-sm font-medium text-ink mb-1">Questionário inicial</h3>
        <p className="text-xs text-faint">
          Estas respostas definem quais partes da declaração fazem sentido pro seu caso. Nenhuma resposta bloqueia o
          uso do app — perfis fora do escopo desta primeira versão (dependentes, declaração conjunta, trust, entidade
          controlada no exterior) só recebem um aviso recomendando validação com um contador.
        </p>
      </div>

      <div>
        <p className="text-xs text-faint uppercase tracking-wide mb-1">Residência fiscal</p>
        <Toggle label="Residente fiscal no Brasil durante o ano" {...register("residente_brasil")} />
        {residenteBrasil && (
          <div className="pl-7 pb-2">
            <label className="label">Residente desde (opcional)</label>
            <input type="date" {...register("residente_desde")} className="input !w-auto" />
          </div>
        )}
        <Toggle
          label="Mudança de residência ou saída definitiva do Brasil neste ano"
          descricao="Se marcado, seu caso pode precisar de fichas específicas que esta versão ainda não cobre."
          {...register("saida_definitiva")}
        />
      </div>

      <div>
        <p className="text-xs text-faint uppercase tracking-wide mb-1">Situação nos Estados Unidos</p>
        <Toggle
          label="Nonresident alien confirmado (não é cidadão nem residente fiscal dos EUA)"
          {...register("nonresident_alien")}
        />
        <Toggle label="Sou cidadão(ã) americano(a)" {...register("cidadania_eua")} />
        <Toggle label="Tenho Green Card" {...register("green_card")} />
        <Toggle
          label="Sou classificado(a) como U.S. Person"
          descricao="Inclui outras classificações fiscais americanas além de cidadania/Green Card."
          {...register("us_person")}
        />
        <div className="pl-7 py-1">
          <label className="label">Dias de presença física nos EUA no ano (opcional)</label>
          <input
            type="number"
            {...register("dias_presenca_eua", { valueAsNumber: true })}
            className="input !w-32"
            min={0}
          />
        </div>
        {usPersonOuSimilar && (
          <p className="text-xs text-danger bg-danger-soft rounded-md px-3 py-2 mt-1">
            Com cidadania, Green Card ou classificação U.S. Person, a camada informativa americana deste app não se
            aplica ao seu caso sem revisão de um profissional especializado nos dois países.
          </p>
        )}
      </div>

      <div>
        <p className="text-xs text-faint uppercase tracking-wide mb-1">Escopo da declaração</p>
        <Toggle label="Tenho dependentes na declaração" {...register("possui_dependentes")} />
        <Toggle label="Declaro em conjunto com cônjuge/companheiro(a)" {...register("declaracao_conjunta")} />
        <Toggle label="Sou beneficiário(a) ou instituidor(a) de trust no exterior" {...register("possui_trust")} />
        <Toggle
          label="Possuo entidade controlada (offshore) no exterior"
          {...register("possui_controlada_exterior")}
        />
        {foraEscopo && (
          <p className="text-xs text-danger bg-danger-soft rounded-md px-3 py-2 mt-1">
            Esta primeira versão prepara só a declaração individual do titular, sem dependentes, declaração conjunta,
            trust ou entidade controlada. Use os números do app como apoio, mas valide esses pontos com um contador.
          </p>
        )}
      </div>

      <button type="submit" disabled={isSubmitting} className="btn btn-primary">
        {isSubmitting ? "Salvando..." : "Salvar e continuar"}
      </button>
    </form>
  );
}
