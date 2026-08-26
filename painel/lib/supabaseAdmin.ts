import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only — uses the service_role key, which must never reach the
// browser bundle. Only import this from API routes / server components.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Verifies the bearer token from an incoming request actually belongs to
// a logged-in Supabase user before any handler touches the database.
export async function requireUser(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}
