"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabaseClient";

type Papel = { id: string; nome: string; modulos: string[] };
type Agent = {
  id: string;
  device_id: string;
  nome: string | null;
  papel_id: string | null;
  upseller_puid: string | null;
  last_checkin_at: string | null;
};

export default function Dashboard() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [papeis, setPapeis] = useState<Papel[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    supabaseBrowser.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (session === null) {
      router.replace("/login");
    }
  }, [session, router]);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const res = await fetch("/api/agents", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await res.json();
    setAgents(json.agents ?? []);
    setPapeis(json.papeis ?? []);
    setLoading(false);
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateAgent(id: string, patch: Partial<Pick<Agent, "nome" | "papel_id">>) {
    if (!session) return;
    setSavingId(id);
    await fetch(`/api/agents/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(patch),
    });
    await load();
    setSavingId(null);
  }

  if (session === undefined || session === null) {
    return <div className="min-h-screen bg-neutral-950" />;
  }

  const naoDefinidos = agents.filter((a) => !a.papel_id);
  const definidos = agents.filter((a) => a.papel_id);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold">Kryzer — Computadores</h1>
          <button
            onClick={() => supabaseBrowser.auth.signOut()}
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            Sair
          </button>
        </div>

        {loading && <p className="text-neutral-400 text-sm mb-4">Carregando...</p>}

        {naoDefinidos.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-medium text-amber-400 mb-3">
              Não definidos ({naoDefinidos.length})
            </h2>
            <div className="flex flex-col gap-2">
              {naoDefinidos.map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  papeis={papeis}
                  saving={savingId === a.id}
                  onSave={(patch) => updateAgent(a.id, patch)}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-sm font-medium text-neutral-400 mb-3">
            Definidos ({definidos.length})
          </h2>
          <div className="flex flex-col gap-2">
            {definidos.map((a) => (
              <AgentRow
                key={a.id}
                agent={a}
                papeis={papeis}
                saving={savingId === a.id}
                onSave={(patch) => updateAgent(a.id, patch)}
              />
            ))}
            {definidos.length === 0 && (
              <p className="text-sm text-neutral-500">Nenhum computador definido ainda.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  papeis,
  saving,
  onSave,
}: {
  agent: Agent;
  papeis: Papel[];
  saving: boolean;
  onSave: (patch: Partial<Pick<Agent, "nome" | "papel_id">>) => void;
}) {
  const [nome, setNome] = useState(agent.nome ?? "");
  const [papelId, setPapelId] = useState(agent.papel_id ?? "");

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-neutral-800 bg-neutral-900">
      <div className="flex-1 min-w-0">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome (ex: Expedição 01)"
          className="w-full bg-transparent text-sm font-medium outline-none border-b border-transparent focus:border-neutral-600"
        />
        <p className="text-xs text-neutral-500 truncate">
          {agent.device_id} · puid {agent.upseller_puid ?? "—"} ·{" "}
          {agent.last_checkin_at
            ? `visto ${new Date(agent.last_checkin_at).toLocaleString("pt-BR")}`
            : "nunca conectado"}
        </p>
      </div>
      <select
        value={papelId}
        onChange={(e) => setPapelId(e.target.value)}
        className="bg-neutral-800 border border-neutral-700 rounded-md text-sm px-2 py-1"
      >
        <option value="">— sem papel —</option>
        {papeis.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </select>
      <button
        disabled={saving}
        onClick={() => onSave({ nome: nome || null, papel_id: papelId || null })}
        className="px-3 py-1.5 rounded-md bg-white text-black text-sm font-medium disabled:opacity-50"
      >
        {saving ? "..." : "Salvar"}
      </button>
    </div>
  );
}
