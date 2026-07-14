import { redirect } from "next/navigation";
import { obterDadosConfiguracoes } from "./actions";
import { obterDiretoriaBacen, obterPresidentesBrasil } from "@/lib/referencia/actions";
import ConfiguracoesForm from "./ConfiguracoesForm";

export default async function ConfiguracoesPage() {
  const dados = await obterDadosConfiguracoes();

  if (!dados) redirect("/login");

  const [diretoriaBacen, presidentesBrasil] = await Promise.all([
    obterDiretoriaBacen(),
    obterPresidentesBrasil(),
  ]);

  return (
    <div className="px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-medium text-ink mb-1">Configurações</h1>
        <p className="text-sm text-muted mb-8">
          Seus dados pessoais, perfil de investidor, segurança da conta e cadastros de referência
          (diretoria do Bacen, presidentes do Brasil).
        </p>
        <ConfiguracoesForm
          dadosIniciais={dados}
          diretoriaBacenInicial={diretoriaBacen}
          presidentesBrasilInicial={presidentesBrasil}
        />
      </div>
    </div>
  );
}
