// app/lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    // ✅ PWA/スマホでセッションが消えにくくする
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // デフォルトは localStorage。PWAでもこれが最も安定。
    storageKey: "ai-ky-web-auth",
  },
});
