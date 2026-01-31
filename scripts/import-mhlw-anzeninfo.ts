// scripts/import-mhlw-anzeninfo.ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!; // ← server用。必ず .env に入れる
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BASE = "https://anzeninfo.mhlw.go.jp";
const FIND_URL = `${BASE}/anzen_pg/SAI_FND.aspx`; // 検索一覧（公式入口）
const DET_URL = `${BASE}/anzen_pg/SAI_DET.aspx?joho_no=`; // 詳細
const SOURCE_ORG = "mhlw_anzeninfo";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "KySafetyBot/1.0 (contact: your-company-admin)",
      "Accept": "text/html,application/xhtml+xml",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!res.ok) throw new Error(`fetch failed ${res.status} ${url}`);

  const buf = Buffer.from(await res.arrayBuffer());

  // まずUTF-8で読めるか試し、ダメならcp932で読む（実運用で安定）
  const utf8 = buf.toString("utf8");
  const looksBroken = utf8.includes("�") && !utf8.includes("</html>"); // 雑に判定
  const html = looksBroken ? iconv.decode(buf, "cp932") : utf8;

  return { html, res };
}

function extractJohoNos(html: string): number[] {
  const $ = cheerio.load(html);
  const nums = new Set<number>();

  $("a[href]").each((_, a) => {
    const href = String($(a).attr("href") ?? "");
    const m = href.match(/SAI_DET\.aspx\?joho_no=(\d+)/i);
    if (m) nums.add(Number(m[1]));
  });

  return [...nums].sort((a, b) => a - b);
}

// ASP.NET postback（javascript:__doPostBack('target','arg')）を拾う
function extractPostbackNext(html: string): { target: string; arg: string } | null {
  const $ = cheerio.load(html);

  // 「次へ」「Next」相当を優先（サイトの表記揺れに耐える）
  const cand = $("a[href]")
    .toArray()
    .map((a) => ({
      text: $(a).text().trim(),
      href: String($(a).attr("href") ?? ""),
    }))
    .find((x) => /次|Next|＞|›/.test(x.text) && x.href.includes("__doPostBack"));

  if (!cand) return null;

  const m = cand.href.match(/__doPostBack\('([^']+)','([^']*)'\)/);
  if (!m) return null;

  return { target: m[1], arg: m[2] };
}

function extractHiddenFields(html: string) {
  const $ = cheerio.load(html);
  const fields: Record<string, string> = {};
  $("input[type=hidden]").each((_, el) => {
    const name = String($(el).attr("name") ?? "");
    if (!name) return;
    fields[name] = String($(el).attr("value") ?? "");
  });
  return fields;
}

async function listAllJohoNo(limitPages = 9999) {
  const all = new Set<number>();

  let page = 0;
  let html: string;

  // 1) 初回GET
  {
    const r = await fetchHtml(FIND_URL);
    html = r.html;
  }

  while (page < limitPages) {
    page++;

    // joho_no 回収
    for (const n of extractJohoNos(html)) all.add(n);

    // 次ページ判定
    const pb = extractPostbackNext(html);
    if (!pb) break;

    const hidden = extractHiddenFields(html);
    const body = new URLSearchParams();
    // ASP.NETポストバックに必要な隠し項目を全部積む
    for (const [k, v] of Object.entries(hidden)) body.set(k, v);
    body.set("__EVENTTARGET", pb.target);
    body.set("__EVENTARGUMENT", pb.arg);

    // 2) POSTで次ページ
    const r2 = await fetchHtml(FIND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    html = r2.html;

    // サーバー負荷軽減
    await sleep(400);
  }

  return [...all].sort((a, b) => a - b);
}

function pickText($: cheerio.CheerioAPI, selectors: string[]) {
  for (const sel of selectors) {
    const t = $(sel).text().trim();
    if (t) return t;
  }
  return "";
}

function clean(s: string) {
  return s.replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchDetail(johoNo: number) {
  const url = `${DET_URL}${johoNo}`;
  const { html } = await fetchHtml(url);

  const $ = cheerio.load(html);

  // タイトル：h1/h2/太字の先頭など（サイトのDOM差に耐える）
  const title =
    clean(
      pickText($, [
        "h1",
        "h2",
        ".title",
        "span#lblTitle",
        "span[id*=Title]",
        "td.title",
      ])
    ) || `労働災害事例（joho_no=${johoNo}）`;

  // 本文の主要セクション（“発生状況/原因/対策”の並びが多い）
  // ここはDOMの揺れがあるので「見出し語の近傍テキスト」を拾う戦略
  const bodyText = clean($("body").text());

  // 雑だが強い：本文全体からキーワード近傍を抜く（後で精密化可能）
  function near(keyword: string) {
    const idx = bodyText.indexOf(keyword);
    if (idx < 0) return "";
    return clean(bodyText.slice(idx, Math.min(bodyText.length, idx + 600)));
  }

  const summary = near("発生状況") || near("災害発生状況") || "";
  const cause = near("発生原因") || near("原因") || "";
  const measures = near("対策") || near("再発防止") || "";

  // 事故の型/業種/作業 などが表で出ている場合に拾う（見つからなければ空）
  const industry = "";
  const workType = "";
  const accidentType = "";

  return {
    source_org: SOURCE_ORG,
    source_title: title,
    source_url: url,
    published_date: null as string | null,
    industry: industry || null,
    work_type: workType || null,
    accident_type: accidentType || null,
    weather_related: null as string | null,
    summary: summary || null,
    cause: cause || null,
    measures: measures || null,
    raw_text: bodyText || null,
    tags: null as string[] | null,
  };
}

async function upsertCase(row: any) {
  const { error } = await supabase
    .from("accident_cases")
    .upsert(row, { onConflict: "source_url" });

  if (error) throw error;
}

async function main() {
  console.log("Collecting joho_no from:", FIND_URL);
  const johoNos = await listAllJohoNo();
  console.log("Total joho_no found:", johoNos.length);

  // 最初は安全に少なめで動作確認したい場合：
  // const target = johoNos.slice(0, 50);
  const target = johoNos;

  let ok = 0;
  let ng = 0;

  for (const johoNo of target) {
    try {
      const row = await fetchDetail(johoNo);
      await upsertCase(row);
      ok++;
      if (ok % 50 === 0) console.log(`OK ${ok}/${target.length}`);
      await sleep(350); // 負荷軽減（必須）
    } catch (e: any) {
      ng++;
      console.warn("NG joho_no=", johoNo, e?.message ?? e);
      await sleep(700);
    }
  }

  console.log("done. ok:", ok, "ng:", ng);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
