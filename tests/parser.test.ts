import { parseLines, matchQuestionHead, matchChoice, type OcrLine } from "../src/kakomon/parser";

let pass = 0, fail = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; console.error(`✗ ${label}\n  expected: ${e}\n  actual:   ${a}`); }
}
const L = (texts: string[]): OcrLine[] =>
  texts.map((text, i) => ({ text, x: 0, y: i * 30, w: 500, h: 24, conf: 0.9 }));

// 見出し
eq(matchQuestionHead("第 12 問"), { number: "12", rest: "" }, "第n問");
eq(matchQuestionHead("第３問 インテリアの歴史に関する"), { number: "3", rest: "インテリアの歴史に関する" }, "全角+本文");
eq(matchQuestionHead("問5 次の記述のうち"), { number: "5", rest: "次の記述のうち" }, "問n形式");
eq(matchQuestionHead("これは普通の文です"), null, "非見出し");

// 見出し: 問題集の枝番(□1-1)。OCRの表記揺れを吸収する
eq(matchQuestionHead("□1-1"), { number: "1-1", rest: "" }, "枝番(チェックボックス付き)");
eq(matchQuestionHead("口1−1"), { number: "1-1", rest: "" }, "枝番(□が口に化け+全角マイナス)");
eq(matchQuestionHead("1ー2 【 ア 】の部分"), { number: "1-2", rest: "【 ア 】の部分" }, "枝番(長音記号+本文)");
eq(matchQuestionHead("第38回(2020年)第1問／チェック"), null, "回次見出しは拾わない");
eq(matchQuestionHead("51C型住宅"), null, "型番は枝番と誤認しない");
eq(matchQuestionHead("2020年"), null, "西暦は枝番と誤認しない");

// 選択肢
eq(matchChoice("1. アール・ヌーヴォー"), { index: 1, text: "アール・ヌーヴォー" }, "数字+ドット");
eq(matchChoice("３、マンセル表色系"), { index: 3, text: "マンセル表色系" }, "全角数字+読点");
eq(matchChoice("ウ LED照明"), { index: 3, text: "LED照明" }, "カナ選択肢");
eq(matchChoice("① 折敷(おしき)"), { index: 1, text: "折敷(おしき)" }, "丸数字");
eq(matchChoice("③卓袱台"), { index: 3, text: "卓袱台" }, "丸数字(空白なし)");
eq(matchChoice("(2) 箱膳"), { index: 2, text: "箱膳" }, "括弧数字");
eq(matchChoice("18 [1. インテリア販売]"), null, "ページ番号を選択肢と誤認しない");

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
eq(drafts[0].number, "1", "問1の番号");
eq(drafts[0].choices[1], "アール・デコは曲線を多用する。様式である。", "折返し連結");
eq(drafts[0].choices[2], "ウィリアム・モリスはアーツ・アンド・クラフツ運動を主導した。", "折返し連結2");
eq(drafts[1].number, "2", "問2の番号");
eq(drafts[1].choices[0], "色相は10色相に分割される。", "問2選択肢1");
eq(drafts[0].rawText.startsWith("令和5年度"), true, "前文をrawTextに保持");

// 問題文中の "2." 誤検出ガード(選択肢1より前に2が出ても無視)
const g = parseLines(L([
  "第1問 図2.に示す平面図について答えよ。",
  "1 リビングの面積は20㎡である。",
  "2 廊下の幅は90cmである。",
]));
eq(g[0].choices[0], "リビングの面積は20㎡である。", "誤検出ガード後も選択肢1が正しい");

// 分割: 問題集の書式(枝番 + 丸数字3択)。実際のページ1枚ぶん
const w = parseLines(L([
  "1. インテリア販売　①住宅と社会",
  "第38回(2020年)第1問／チェック□□□",
  "重要度★★★",
  "日本における住まい方に関する次の記述の【　】部分に、",
  "それぞれの語群の中から最も適当なものを選びなさい。",
  "□1-1",
  "【　ア　】の部分",
  "① 折敷(おしき)",
  "② 箱膳",
  "③ 卓袱台(ちゃぶだい)",
  "□1-2",
  "【　イ　】の部分",
  "① 標準化",
  "② 和洋折衷",
  "③ 食寝分離",
  "18 [1. インテリア販売]",
]));
eq(w.length, 2, "枝番2問に分割");
eq(w[0].number, "1-1", "枝番1-1");
eq(w[0].question, "【　ア　】の部分", "枝番の問題文");
eq(w[0].choices.slice(0, 3), ["折敷(おしき)", "箱膳", "卓袱台(ちゃぶだい)"], "丸数字3択");
eq(w[0].choices[3], "", "4択目は空のまま");
eq(w[1].number, "1-2", "枝番1-2");
eq(w[1].choices[2], "食寝分離", "2問目の選択肢3");
eq(w[0].rawText.includes("日本における住まい方"), true, "共通の記述文を先頭ドラフトのrawTextに保持");

// 実機のOCR出力そのまま(Android/lite)。番号の欠落と括弧落ちを含む
const real = parseLines(L([
  "電期度★★★",
  "それは、 このようなる。 このようなる。 このようなる。 この",
  "□-1",
  "ア1の部分",
  "①折数(おしき)",
  "②箱膳",
  "③卓袱台(ちゃぶだい)",
  "□1-2",
  "イ1の部分",
  "①標準化",
  "②和洋折衷",
  "③食寝分離",
  "□1--",
  "【ウ】の部分",
  "①DK型",
  "②LD型",
  "③LDK型",
  "C.  . C. C. C. C. 10.00000..00",
]));
eq(real.length, 3, "番号が欠けても3問に分割");
eq(real.map((d) => d.number), ["1-1", "1-2", "1-3"], "欠けた番号を前後から補完");
eq(real[0].choices.slice(0, 3), ["折数(おしき)", "箱膳", "卓袱台(ちゃぶだい)"], "1問目の選択肢");
eq(real[1].choices.slice(0, 3), ["標準化", "和洋折衷", "食寝分離"], "2問目の選択肢");
eq(real[2].choices.slice(0, 3), ["DK型", "LD型", "LDK型"], "3問目の選択肢");
eq(real[1].question, "イ1の部分", "括弧落ちの設問文を選択肢イと誤検出しない");
eq(matchChoice("ア1の部分"), null, "区切りなしのカナは選択肢とみなさない");
eq(matchChoice("ウ LED照明"), { index: 3, text: "LED照明" }, "区切りありのカナは従来どおり");

// 1問も検出できないケース
const none = parseLines(L(["ただの説明文です", "見出しはありません"]));
eq(none.length, 1, "未検出時は1ドラフト");
eq(none[0].number, null, "番号なし");
eq(none[0].rawText.includes("ただの説明文です"), true, "生テキスト保持");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
