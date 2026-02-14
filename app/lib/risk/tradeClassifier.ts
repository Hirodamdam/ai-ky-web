// app/lib/risk/tradeClassifier.ts
function s(v: any) {
  return v == null ? "" : String(v);
}

export function classifyTrade(workDetail: string | null | undefined): string {
  const t = s(workDetail).trim();
  const x = t.replace(/\s+/g, "");
  if (!x) return "未分類";

  if (/(交通規制|片側交互通行|通行止|誘導員|保安員|カラーコーン|バリケード)/.test(x)) return "交通規制";
  if (/(法面|斜面|モルタル吹付|植生|アンカー|ロックボルト|法肩|崩壊|土砂)/.test(x)) return "法面";
  if (/(掘削|床掘|埋戻|残土|山留|土留|土工|バックホウ|ユンボ)/.test(x)) return "土工";
  if (/(管|配管|布設|埋設|マンホール|桝|下水|上水|給水|排水)/.test(x)) return "管布設";
  if (/(舗装|アスファルト|As|舗設|切削|転圧|ローラ|乳剤|路盤)/.test(x)) return "舗装";
  if (/(橋梁|橋台|橋脚|支承|桁|床版|伸縮装置)/.test(x)) return "橋梁";
  if (/(トンネル|覆工|坑内|坑口|ずり出し)/.test(x)) return "トンネル";
  if (/(解体|斫り|はつり|撤去|取り壊し)/.test(x)) return "解体";

  return "その他";
}
