import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-medium text-ink mb-3">
          App do Investidor
        </h1>
        <p className="text-muted mb-8">
          Gerencie seus investimentos com um perfil de suitability completo.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/login" className="btn btn-primary">
            Entrar
          </Link>
          <Link href="/cadastro" className="btn btn-secondary">
            Criar conta
          </Link>
        </div>
      </div>
    </div>
  );
}
