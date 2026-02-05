// app/api/ky-photo-upload/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

function extFromName(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "jpg";
}

export async function POST(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.NEXT_PUBLIC_KY_PHOTO_BUCKET || "ky-photos";

    if (!url || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    // multipart/form-data
    const form = await req.formData();

    const projectId = s(form.get("project_id")).trim();
    const kyId = s(form.get("ky_id")).trim(); // ky_entries.id を入れる想定
    const kind = s(form.get("kind")).trim(); // "slope" | "path"
    const file = form.get("file");

    if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });
    if (!kyId) return NextResponse.json({ error: "ky_id is required" }, { status: 400 });
    if (kind !== "slope" && kind !== "path") {
      return NextResponse.json({ error: "kind must be slope or path" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const supabaseAdmin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });

    const ext = extFromName(file.name);
    const path = `ky/${projectId}/${kind}_${Date.now()}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const { error: upErr } = await supabaseAdmin.storage.from(bucket).upload(path, bytes, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || "application/octet-stream",
    });
    if (upErr) throw upErr;

    const { data: pub } = supabaseAdmin.storage.from(bucket).getPublicUrl(path);
    const publicUrl = pub?.publicUrl || "";
    if (!publicUrl) throw new Error("Failed to get public URL");

    // ky_photos：image_url NOT NULL を必ず満たす
    const row = {
      project_id: projectId,
      ky_id: kyId,
      ky_entry_id: kyId, // 互換
      kind,              // 今のあなたのKyNewClientに合わせる
      image_url: publicUrl,
      photo_url: publicUrl, // 互換（nullableでも入れておく）
    };

    const { error: insErr } = await supabaseAdmin.from("ky_photos").insert(row);
    if (insErr) throw insErr;

    return NextResponse.json({ ok: true, public_url: publicUrl, path });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Upload failed" }, { status: 500 });
  }
}
