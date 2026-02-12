import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Body = {
  projectId?: string;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const projectId = s(body.projectId).trim();

    if (!projectId) {
      return NextResponse.json({ error: "projectId required" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(url, serviceKey);

    // ① KY削除
    await supabase.from("ky_entries").delete().eq("project_id", projectId);

    // ② プロジェクト削除
    await supabase.from("projects").delete().eq("id", projectId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "delete failed" }, { status: 500 });
  }
}
