import { requireUser, supabaseAdmin } from "@/lib/supabaseAdmin";

export async function PATCH(req: Request, ctx: RouteContext<"/api/agents/[id]">) {
  const user = await requireUser(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  let body: { nome?: string | null; papel_id?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if ("nome" in body) patch.nome = body.nome;
  if ("papel_id" in body) patch.papel_id = body.papel_id;

  const { error } = await supabaseAdmin.from("agents").update(patch).eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ status: "ok" });
}
