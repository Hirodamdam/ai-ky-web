import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // ブラウザ環境のみ localStorage を使う（PWA/スマホでの保持を安定化）
    storage:
      typeof window !== "undefined"
        ? window.localStorage
        : undefined,
  },
});
