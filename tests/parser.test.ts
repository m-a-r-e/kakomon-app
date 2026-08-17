import { parseLines, matchQuestionHead, matchChoice, type OcrLine } from "../src/kakomon/parser";

let pass = 0, fail = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; console.error(`✗ ${label}\n  expected: ${e}\n  actual:   ${a}`); }
}
const L = (texts: string[]): OcrLine[] =>
  texts.map((text, i) => ({ text, x: 0, y: i * 30, w: 500, h: 24, conf: 0.9 }));

// 見出し
eq(matchQuestionHead("第 12 問"), { number: 12, rest: "" }, "第n問");
eq(matchQuestionHead("第３問 インテリアの歴史に関する"), { number: 3, rest: "インテリアの歴史に関する" }, "全角+本文");
eq(matchQuestionHead("問5 次の記述のうち"), { number: 5, rest: "次の記述のうち" }, "問n形式");
eq(matchQuestionHead("これは普通の文です"), null, "非見出し");

// 選択肢
eq(matchChoice("1. アール・ヌーヴォー"), { index: 1, text: "アール・ヌーヴォー" }, "数字+ドット");
eq(matchChoice("３、マンセル表色系"), { index: 3, text: "マンセル表色系" }, "全角数字+読点");
eq(matchChoice("ウ LED照明"), { index: 3, text: "LED照明" }, "カナ選択肢");

// 分割: 基本形
const drafts = parseLines(L([
  "令和5年度 インテリアコーディネーター試験",
  "第1問 次の記述のうち、最も不適当なものを選べ。",
  "1 バウハウスはドイツで設立された。",
  "2 アール・デコは曲線を多用する。",
  "様式である。",
  "3 ウィリアム・モリスはアーツ・アンド・",
  "クラフツ運動を主導した。",
  "第2問 マンセル表色系に関する問題。",
  "1 色相は10色相に分割される。",
  "2 明度は0から10で表す。",
]));
eq(drafts.length, 2, "2問に分割");
eq(drafts[0].number, 1, "問1の番号");
eq(drafts[0].choices[1], "アール・デコは曲線を多用する。様式である。", "折返し連結");
eq(drafts[0].choices[2], "ウィリアム・モリスはアーツ・アンド・クラフツ運動を主導した。", "折返し連結2");
eq(drafts[1].number, 2, "問2の番号");
eq(drafts[1].choices[0], "色相は10色相に分割される。", "問2選択肢1");
eq(drafts[0].rawText.startsWith("令和5年度"), true, "前文をrawTextに保持");

// 問題文中の "2." 誤検出ガード(選択肢1より前に2が出ても無視)
const g = parseLines(L([
  "第1問 図2.に示す平面図について答えよ。",
  "1 リビングの面積は20㎡である。",
  "2 廊下の幅は90cmである。",
]));
eq(g[0].choices[0], "リビングの面積は20㎡である。", "誤検出ガード後も選択肢1が正しい");

// 1問も検出できないケース
const none = parseLines(L(["ただの説明文です", "見出しはありません"]));
eq(none.length, 1, "未検出時は1ドラフト");
eq(none[0].number, null, "番号なし");
eq(none[0].rawText.includes("ただの説明文です"), true, "生テキスト保持");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
