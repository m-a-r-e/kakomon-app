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
const CHOICE_KANA = /^([アイウエオ])\s*[.．、,，)）:：]?\s*(.*)$/;
const KANA_INDEX: Record<string, number> = { ア: 1, イ: 2, ウ: 3, エ: 4, オ: 5 };
const CIRCLED = "①②③④⑤";
// ページ番号と柱(ページ端の見出し)。"18" "18 [1. インテリア販売]" など
const PAGE_FURNITURE = /^(?:[0-9]{1,4}\s*(?:\[[^\]]*\])?|\[[^\]]*\]\s*[0-9]{1,4})$/;

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

    const head = matchQuestionHead(text);
    if (head) {
      push();
      cur = {
        number: head.number,
        question: head.rest,
        choices: ["", "", "", "", ""],
        rawText: text,
      };
      curChoice = -1;
      continue;
    }

    if (!cur) {
      preamble.push(text);
      continue;
    }

    cur.rawText += "\n" + text;

    // ページ番号や柱は本文ではないので、選択肢の折返しとして連結しない
    if (PAGE_FURNITURE.test(toHalfWidth(text))) continue;

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
