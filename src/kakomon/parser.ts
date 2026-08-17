/**
 * OCR結果(読み順整序済みの行)を問題単位に分割するパーサ。
 * インテリアコーディネーター試験の定型(第◯問 + 選択肢1〜5/ア〜オ)を想定。
 * 失敗してもエラーにせず、分割できなかったテキストは rawText として残す。
 */

export interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
}

export interface QuestionDraft {
  /** 本の表記をそのまま持つ。"3"(第3問) や "1-1"(□1-1) など */
  number: string | null;
  question: string;
  choices: string[];
  rawText: string; // この問題に属する全行(修正時の参照用)
}

/** 全角数字→半角 */
export function toHalfWidth(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 枝番見出し: "□1-1" "1-1" など(問題集の小問)。
// 先頭のチェックボックスはOCRが □/口/■ などに揺れるため広めに許容し、
// 区切りのハイフンも半角/全角/長音記号の取り違えを吸収する。
const Q_HEAD_SUB = /^[□口■▢〼\s]*([0-9]{1,3})\s*[-−ー―—‐–ｰ]\s*([0-9]{1,3})(?![0-9])\s*(.*)$/;
const Q_HEAD = /^[第\s]*([0-9]{1,3})\s*問/;
const Q_HEAD_ALT = /^問\s*([0-9]{1,3})[^0-9]?/;
// 選択肢: "①..." "(1)..." "1 ..." "1. ..." "１、..." "ア ..." など
// (?![0-9]) はページ番号 "18" を選択肢1と誤検出しないためのガード
const CHOICE_CIRCLED = /^([①②③④⑤])\s*[.．、,，)）:：]?\s*(.*)$/;
const CHOICE_PAREN = /^[(（]\s*([1-5])\s*[)）]\s*(.*)$/;
const CHOICE_NUM = /^([1-5])(?![0-9])\s*[.．、,，)）:：]?\s*(.*)$/;
// カナは日本語本文にも普通に現れるので、区切り(空白か約物)を必須にする。
// これがないと "ア1の部分"(【 ア 】の括弧をOCRが落とした形)を選択肢アと誤検出する
const CHOICE_KANA = /^([アイウエオ])(?:\s+|[.．、,，)）:：]\s*)(.*)$/;
const KANA_INDEX: Record<string, number> = { ア: 1, イ: 2, ウ: 3, エ: 4, オ: 5 };
const CIRCLED = "①②③④⑤";
// ページ番号と柱(ページ端の見出し)。"18" "18 [1. インテリア販売]" など
const PAGE_FURNITURE = /^(?:[0-9]{1,4}\s*(?:\[[^\]]*\])?|\[[^\]]*\]\s*[0-9]{1,4})$/;
// チェックボックスで始まり数字とハイフンしか含まない行は小問の見出しとみなす。
// 実機のOCRは "□-1"(大問番号が落ちる) "□1--"(小問番号が落ちる) のように
// 数字を取りこぼすので、欠けた側は直前の見出しから補う
const SUB_HEAD_LOOSE = /^[□口■▢〼]\s*([0-9]{1,3})?\s*([-−ー―—‐–]{1,2})?\s*([0-9]{1,3})?\s*$/;

// OCRが裏写りや罫線を拾って出す屑行("C.  . C. C. 10.00000..00" など)。
// 日本語を1文字も含まず、2文字以上つながった英単語もない行は本文とみなさない
const CJK = /[぀-ヿ㐀-鿿豈-﫿]/;
const isNoiseLine = (t: string) => !CJK.test(t) && !/[A-Za-z]{2,}/.test(t);

export interface SubHead {
  major: string | null;
  minor: string | null;
}

export function matchSubHeadLoose(line: string): SubHead | null {
  const m = toHalfWidth(line.trim()).match(SUB_HEAD_LOOSE);
  if (!m) return null;
  if (!m[1] && !m[2] && !m[3]) return null; // "□" 単独は見出しとみなさない
  return { major: m[1] ?? null, minor: m[3] ?? null };
}

interface HeadMatch {
  number: string;
  rest: string;
}

const num = (s: string) => String(parseInt(s, 10)); // "０３" → "3"

export function matchQuestionHead(line: string): HeadMatch | null {
  const t = toHalfWidth(line.trim());
  // 枝番("1-1")を先に見る。"第◯問" 形式は先頭が「第」なので取り違えない
  let m = t.match(Q_HEAD_SUB);
  if (m) return { number: `${num(m[1])}-${num(m[2])}`, rest: m[3].trim() };
  m = t.match(Q_HEAD);
  if (m) return { number: num(m[1]), rest: t.slice(m[0].length).trim() };
  m = t.match(Q_HEAD_ALT);
  if (m) return { number: num(m[1]), rest: t.slice(m[0].length).trim() };
  return null;
}

interface ChoiceMatch {
  index: number; // 1-5
  text: string;
}

export function matchChoice(line: string): ChoiceMatch | null {
  const t = toHalfWidth(line.trim());
  let m = t.match(CHOICE_CIRCLED);
  if (m) return { index: CIRCLED.indexOf(m[1]) + 1, text: m[2] };
  m = t.match(CHOICE_PAREN);
  if (m) return { index: parseInt(m[1], 10), text: m[2] };
  m = t.match(CHOICE_NUM);
  if (m) return { index: parseInt(m[1], 10), text: m[2] };
  m = t.match(CHOICE_KANA);
  if (m) return { index: KANA_INDEX[m[1]], text: m[2] };
  return null;
}

/**
 * 行配列を問題ドラフトに分割する。
 * ルール:
 * - 問題見出し行で新しいドラフトを開始
 * - 選択肢マーカー行以降は選択肢に蓄積(同一選択肢の折返し行は直前の選択肢に連結)
 * - 見出しより前の行(ページヘッダ等)は捨てずに先頭ドラフトの rawText に残す
 */
export function parseLines(lines: OcrLine[]): QuestionDraft[] {
  const drafts: QuestionDraft[] = [];
  let cur: QuestionDraft | null = null;
  let curChoice = -1; // 現在蓄積中の選択肢index(0-based)、-1なら問題文
  let preamble: string[] = [];
  let lastMajor = "1"; // OCRが番号を落としたときの補完元
  let lastMinor = 0;

  const push = () => {
    if (cur) {
      cur.question = cur.question.trim();
      cur.choices = cur.choices.map((c) => c.trim());
      drafts.push(cur);
    }
  };

  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;

    // "□-1" のように数字が欠けた見出しは、直前の見出しから補って続ける
    const sub = matchSubHeadLoose(text);
    if (sub) {
      const major = sub.major ?? lastMajor;
      const minor = sub.minor ?? String(lastMinor + 1);
      lastMajor = major;
      lastMinor = parseInt(minor, 10) || lastMinor + 1;
      push();
      cur = { number: `${major}-${minor}`, question: "", choices: ["", "", "", "", ""], rawText: text };
      curChoice = -1;
      continue;
    }

    const head = matchQuestionHead(text);
    if (head) {
      const mm = head.number.match(/^([0-9]+)-([0-9]+)$/);
      if (mm) { lastMajor = mm[1]; lastMinor = parseInt(mm[2], 10); }
      push();
      cur = { number: head.number, question: head.rest, choices: ["", "", "", "", ""], rawText: text };
      curChoice = -1;
      continue;
    }

    if (!cur) {
      preamble.push(text);
      continue;
    }

    cur.rawText += "\n" + text;

    // ページ番号・柱・OCRの屑行は本文ではないので、選択肢の折返しとして連結しない
    if (PAGE_FURNITURE.test(toHalfWidth(text)) || isNoiseLine(text)) continue;

    const choice = matchChoice(text);
    // 選択肢は昇順に現れる前提。逆行するマッチ(問題文中の "2." 等)は誤検出として無視
    if (choice && choice.index - 1 > curChoice) {
      curChoice = choice.index - 1;
      cur.choices[curChoice] = choice.text;
      continue;
    }

    if (curChoice >= 0) {
      // 選択肢の折返し
      cur.choices[curChoice] += text;
    } else {
      // 問題文の続き
      cur.question += cur.question ? text : text;
    }
  }
  push();

  if (drafts.length === 0 && preamble.length > 0) {
    // 1問も検出できなかった: 生テキストのみのドラフトを返す
    return [
      {
        number: null,
        question: "",
        choices: ["", "", "", "", ""],
        rawText: preamble.join("\n"),
      },
    ];
  }
  if (drafts.length > 0 && preamble.length > 0) {
    drafts[0].rawText = preamble.join("\n") + "\n---\n" + drafts[0].rawText;
  }
  return drafts;
}
