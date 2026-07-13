"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type RedefinirSenhaState = {
  error?: string;
};

export async function redefinirSenha(
  _prevState: RedefinirSenhaState,
  formData: FormData
): Promise<RedefinirSenhaState> {
  const password = String(formData.get("password") ?? "");
  const confirmarPassword = String(formData.get("confirmarPassword") ?? "");

  if (password.length < 8) {
    return { error: "A senha deve ter no mínimo 8 caracteres." };
  }
  if (password !== confirmarPassword) {
    return { error: "As senhas não coincidem." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: "Não foi possível redefinir a senha. O link pode ter expirado — solicite um novo." };
  }

  redirect("/login");
}
