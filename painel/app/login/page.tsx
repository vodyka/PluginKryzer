"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabaseBrowser.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100">
      <div className="w-full max-w-sm p-8 rounded-xl border border-neutral-800 bg-neutral-900">
        <h1 className="text-xl font-semibold mb-1">Kryzer — Painel</h1>
        <p className="text-sm text-neutral-400 mb-6">
          Sem senha: digite seu e-mail e clique no link que chegar na caixa de entrada.
        </p>

        {sent ? (
          <p className="text-sm text-green-400">
            Link enviado para <strong>{email}</strong>. Confira seu e-mail.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder="voce@kryzer.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 text-sm outline-none focus:border-neutral-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-3 py-2 rounded-md bg-white text-black text-sm font-medium disabled:opacity-50"
            >
              {loading ? "Enviando..." : "Enviar link de acesso"}
            </button>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
