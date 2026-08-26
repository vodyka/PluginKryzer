"use client";

import { createClient } from "@supabase/supabase-js";

// Browser-side client — anon key only, safe to expose. Used purely for
// authentication (magic link sign-in/out); all actual data reads/writes
// go through our own API routes (see lib/supabaseAdmin.ts), which check
// this client's session token server-side before touching the database.
export const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
