import path from "node:path";

// ✅ .env.local を確実に読む（Next.js実行とは別なので明示ロード）
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import * as cheerio from "cheerio";

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SB_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

if (!SB_URL || !SB_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error("Missing env. Required:");
  console.error("- SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
  console.error("- SUPABASE_SERVICE_ROLE_KEY");
  console.error("- OPENAI_API_KEY");
  process.exit(1);
}

const supabase = createClient(SB_URL, SB_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/**
 * ✅ ここに災害事例URLを入れる（まずは1〜3件でOK）
 */
const URLS: string[] = [
  "https://anzeninfo.mhlw.go.jp/anzen_pg/SAI_DET.aspx?joho_no=2",
 "https://anzeninfo.mhlw.go.jp/anzen_pg/SAI_DET.aspx?joho_no=3",
 "https://anzeninfo.mhlw.go.jp/anzen_pg/SAI_DET.aspx?joho_no=4",
 "https://anzeninfo.mhlw.go.jp/anzen_pg/SAI_DET.aspx?joho_no=5",
 "https://anzeninfo.mhlw.go.jp/anzen_pg/SAI_DET.aspx?joho_no=6",
 "https://anzeninfo.mhlw.go.jp/anzen_pg/SAI_DET.aspx?joho_no=7",
 "https://anzeninfo.mhlw.go.jp/anzen_pg/SAI_DET.aspx?joho_no=8",
 "https://anzeninfo.mhlw.go.jp/anzen_pg/SAI_DET.aspx?joho_no=9",
 "https://anzeninfo.mhlw.go.jp/anzen_pg/SAI_DET.aspx?joho_no=10",
 "https://anzeninfo.mhlw.go.jp/anzen_pg/SAI_DET.aspx?joho_no=11",

];

// ざっくり本文抽出（まずは body 全体）
function extractText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  const title = $("title").text().trim() || "無題";

  const raw = $("body").text();
  const text = raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text };
}

async function summarize(text: string): Promise<string> {
  const prompt =
    "次の災害事例本文を、KYに使える観点で200〜300字程度に要約してください。" +
    "（事故の型、主要原因、再発防止の要点）。箇条書きは可。\n\n" +
    text.slice(0, 20000);

  // ✅ もっとも確実：input を文字列にする（型エラー回避）
  const r = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: prompt,
  });

  return (r.output_text ?? "").trim().slice(0, 800);
}

async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 15000),
  });
  return res.data[0].embedding;
}

async function main() {
  console.log("ingest start");
  console.log("SB_URL:", SB_URL);
  console.log("URL count:", URLS.length);

  for (const url of URLS) {
    console.log("fetch:", url);

    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn("fetch failed:", resp.status, url);
      continue;
    }

    const html = await resp.text();
    const { title, text } = extractText(html);

    if (!text || text.length < 200) {
      console.warn("too short, skip:", url);
      continue;
    }

    const summary = await summarize(text);
    const embedding = await embed(summary || text);

    const payload = {
      source: "mhlw_anzen",
      url,
      title,
      content_text: text,
      content_summary: summary,
      tags: [] as string[],
      embedding,
      fetched_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("safety_cases")
      .upsert(payload, { onConflict: "url" });

    if (error) {
      console.error("upsert error:", error);
      continue;
    }

    console.log("upsert ok:", url);
  }

  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
