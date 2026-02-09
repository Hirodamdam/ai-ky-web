// app/api/ky-approve/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";

type Body = {
  projectId: string;
  kyId: string;
  accessToken: string; // supabase session access_token
  action?: "approve" | "unapprove";
};

function s(v: any) {
  return v == null ? "" : String(v);
}

// Vercel/Proxy環境で正しいURLを組み立てる
function getBaseUrl(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return host ? `${proto}://${host}` : "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const projectId = s(body.projectId);
    const kyId = s(body.kyId);
    const accessToken = s(body.accessToken);
    const action: "approve" | "unapprove" = body.action ?? "approve";

    const adminUserId = process.env.KY_ADMIN_USER_ID;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!adminUserId || !url || !anonKey || !serviceKey) {
      return NextResponse.json(
        {
          error:
            "Missing env: KY_ADMIN_USER_ID / NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500 }
      );
    }
    if (!projectId || !kyId || !accessToken) {
      return NextResponse.json(
        { error: "Missing body: projectId / kyId / accessToken" },
        { status: 400 }
      );
    }

    // 1) ログインユーザー確認（accessTokenで認証）
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized (invalid session)" }, { status: 401 });
    }
    if (userData.user.id !== adminUserId) {
      return NextResponse.json({ error: "Forbidden (not admin)" }, { status: 403 });
    }

    // 2) 管理クライアント（service role）で更新
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 対象KYの現状取得（public_token が既にあるか確認）
    const { data: current, error: curErr } = await adminClient
      .from("ky_entries")
      .select("id, project_id, is_approved, public_token, work_date")
      .eq("id", kyId)
      .maybeSingle();

    if (curErr) {
      return NextResponse.json({ error: `Fetch ky failed: ${curErr.message}` }, { status: 500 });
    }
    if (!current) {
      return NextResponse.json({ error: "KY not found" }, { status: 404 });
    }
    if (s(current.project_id) !== projectId) {
      return NextResponse.json({ error: "Project mismatch" }, { status: 400 });
    }

    // 参考：工事名も通知に入れる（取れなければ空でOK）
    const { data: proj } = await adminClient
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .maybeSingle();

    const projectName = s(proj?.name);
    const workDate = s((current as any)?.work_date);

    const baseUrl = getBaseUrl(req); // 例: https://ai-ky-web.vercel.app

    if (action === "unapprove") {
      // 安全優先：承認解除＝公開停止（トークンも無効化）
      const { error: updErr } = await adminClient
        .from("ky_entries")
        .update({
          is_approved: false,
          public_token: null,
        })
        .eq("id", kyId);

      if (updErr) {
        return NextResponse.json({ error: `Unapprove failed: ${updErr.message}` }, { status: 500 });
      }

      // ★（任意）承認解除もLINEに流したい場合はここで送信（今は送らない設計）
      return NextResponse.json({ ok: true, action: "unapprove" });
    }

    // approve
    const token = current.public_token || crypto.randomUUID();

    const { error: updErr } = await adminClient
      .from("ky_entries")
      .update({
        is_approved: true,
        public_token: token,
      })
      .eq("id", kyId);

    if (updErr) {
      return NextResponse.json({ error: `Approve failed: ${updErr.message}` }, { status: 500 });
    }

    const publicPath = `/ky/public/${token}`;
    const publicUrl = baseUrl ? `${baseUrl}${publicPath}` : publicPath;

    // 3) ★承認成功後にLINE通知（失敗しても承認は成功扱いにする）
    let lineOk: boolean | null = null;
    let lineError: string | null = null;

    try {
      const pushSecret = process.env.LINE_PUSH_SECRET || "";
      if (!pushSecret) {
        // 環境変数が未設定なら送らない（承認は成功）
        lineOk = null;
        lineError = "LINE_PUSH_SECRET missing (skip)";
      } else {
        const titleParts: string[] = [];
        if (projectName) titleParts.push(projectName);
        if (workDate) titleParts.push(workDate);
        const title = titleParts.length ? titleParts.join(" / ") : "KY承認";

        const res = await fetch(`${baseUrl}/api/line/push-ky`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-line-push-secret": pushSecret,
          },
          body: JSON.stringify({
            title,
            url: publicUrl,
          }),
        });

        const txt = await res.text();
        lineOk = res.ok;
        if (!res.ok) lineError = `push-ky failed: ${res.status} ${txt}`;
      }
    } catch (e: any) {
      lineOk = false;
      lineError = String(e?.message ?? e);
    }

    return NextResponse.json({
      ok: true,
      action: "approve",
      public_token: token,
      public_path: publicPath,
      public_url: publicUrl,
      line_ok: lineOk,
      line_error: lineError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
