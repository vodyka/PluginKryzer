import { requireUser, supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [agentsRes, papeisRes] = await Promise.all([
    supabaseAdmin
      .from("agents")
      .select("id, device_id, nome, papel_id, upseller_puid, last_checkin_at")
      .order("last_checkin_at", { ascending: false, nullsFirst: true }),
    supabaseAdmin.from("papeis").select("id, nome, modulos").order("nome"),
  ]);

  if (agentsRes.error) {
    return Response.json({ error: agentsRes.error.message }, { status: 500 });
  }
  if (papeisRes.error) {
    return Response.json({ error: papeisRes.error.message }, { status: 500 });
  }

  return Response.json({ agents: agentsRes.data, papeis: papeisRes.data });
}
