import { redirect } from "next/navigation";
import { obterStatusCadastro } from "./actions";
import CadastroWizard from "./CadastroWizard";

export default async function CadastroPage() {
  const status = await obterStatusCadastro();

  if (status.cadastroCompleto) {
    redirect("/dashboard");
  }

  return <CadastroWizard statusInicial={status} />;
}
