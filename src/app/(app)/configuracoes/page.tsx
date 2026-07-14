import { redirect } from "next/navigation";
import { obterDadosConfiguracoes } from "./actions";
import {
  obterDiretoriaBacen,
  obterMetasInflacao,
  obterPesosIpca,
  obterPresidentesBrasil,
} from "@/lib/referencia/actions";
import ConfiguracoesForm from "./ConfiguracoesForm";

export default async function ConfiguracoesPage() {
  const dados = await obterDadosConfiguracoes();

  if (!dados) redirect("/login");

  const [diretoriaBacen, presidentesBrasil, pesosIpca, metasInflacao] = await Promise.all([
    obterDiretoriaBacen(),
    obterPresidentesBrasil(),
    obterPesosIpca(),
    obterMetasInflacao(),
  ]);

  return (
    <div className="px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-medium text-ink mb-1">Configurações</h1>
        <p className="text-sm text-muted mb-8">
          Organizado em sub-abas: Dados pessoais (cadastro, perfil de investidor e segurança da
          conta), Selic (diretoria do Bacen e presidentes do Brasil) e IPCA (pesos por grupo e
          metas de inflação).
        </p>
        <ConfiguracoesForm
          dadosIniciais={dados}
          diretoriaBacenInicial={diretoriaBacen}
          presidentesBrasilInicial={presidentesBrasil}
          pesosIpcaInicial={pesosIpca}
          metasInflacaoInicial={metasInflacao}
        />
      </div>
    </div>
  );
}
