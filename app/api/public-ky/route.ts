// app/api/public-ky/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

type KyRow = {
  id: string;
  project_id: string;
  work_date: string | null;
  work_detail: string | null;
  hazards: string | null;
  countermeasures: string | null;
  third_party_level: string | null;
  partner_company_name: string | null;
  weather_slots: any[] | null;
  ai_work_detail: string | null;
  ai_hazards: string | null;
  ai_countermeasures: string | null;
  ai_third_party: string | null;
  is_approved: boolean | null;
  approved_at: string | null;
  public_enabled: boolean;
};

type ProjectRow = {
  id: string;
  name: string | null;
  contractor_name: string | null;
};

// ky_photos の列名差吸収
function pickKind(row: any): string {
  return s(row?.photo_kind).trim() || s(row?.kind).trim() || s(row?.type).trim() || s(row?.category).trim() || "";
}
function pickUrl(row: any): string {
  return (
    s(row?.image_url).trim() ||
    s(row?.photo_url).trim() ||
    s(row?.url).trim() ||
    s(row?.photo_path).trim() ||
    s(row?.path).trim() ||
    ""
  );
}
function canonicalKind(kindRaw: string): "slope" | "path" | "" {
  const k = s(kindRaw).trim();
  if (!k) return "";
  if (k === "slope" || k === "slope_photo" || k === "法面") return "slope";
  if (k === "path" || k === "path_photo" || k === "通路") return "path";
  if (k.includes("slope") || k.includes("法面")) return "slope";
  if (k.includes("path") || k.includes("通路")) return "path";
  return "";
}

export async function GET(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return NextResponse.json({ error: "Missing env" }, { status: 500 });

    const u = new URL(req.url);
    const publicId = s(u.searchParams.get("public_id")).trim();
    const token = s(u.searchParams.get("t")).trim();
    if (!publicId || !token) return NextResponse.json({ error: "missing public_id or token" }, { status: 400 });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: kyData, error: kyErr } = await admin
      .from("ky_entries")
      .select(
        [
          "id",
          "project_id",
          "work_date",
          "work_detail",
          "hazards",
          "countermeasures",
          "third_party_level",
          "partner_company_name",
          "weather_slots",
          "ai_work_detail",
          "ai_hazards",
          "ai_countermeasures",
          "ai_third_party",
          "is_approved",
          "approved_at",
          "public_enabled",
        ].join(",")
      )
      .eq("public_id", publicId)
      .eq("public_token", token)
      .eq("public_enabled", true)
      .eq("is_approved", true)
      .maybeSingle<KyRow>();

    if (kyErr) throw kyErr;
    if (!kyData) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { data: projData, error: pErr } = await admin
      .from("projects")
      .select("id,name,contractor_name")
      .eq("id", kyData.project_id)
      .maybeSingle<ProjectRow>();

    if (pErr) throw pErr;

    const { data: photos, error: phErr } = await admin
      .from("ky_photos")
      .select("*")
      .eq("project_id", kyData.project_id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (phErr) throw phErr;

    let slopeNow = "";
    let slopePrev = "";
    let pathNow = "";
    let pathPrev = "";

    const curKyId = s(kyData.id).trim();

    if (Array.isArray(photos)) {
      for (const row of photos as any[]) {
        const url2 = pickUrl(row);
        if (!url2) continue;

        const k = canonicalKind(pickKind(row));
        if (!k) continue;

        const rowKy = s(row?.ky_id).trim() || s(row?.ky_entry_id).trim();
        const isCurrent = rowKy === curKyId;

        if (k === "slope") {
          if (!slopeNow && isCurrent) slopeNow = url2;
          else if (!slopePrev && !isCurrent) slopePrev = url2;
        } else if (k === "path") {
          if (!pathNow && isCurrent) pathNow = url2;
          else if (!pathPrev && !isCurrent) pathPrev = url2;
        }

        if (slopeNow && slopePrev && pathNow && pathPrev) break;
      }
    }

    return NextResponse.json({
      ok: true,
      ky: kyData,
      project: projData ?? null,
      photos: { slopeNow, slopePrev, pathNow, pathPrev },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "failed" }, { status: 500 });
  }
}
