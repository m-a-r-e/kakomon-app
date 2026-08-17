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
  number: number | null;
  question: string;
  choices: string[];
  rawText: string; // この問題に属する全行(修正時の参照用)
}

/** 全角数字→半角 */
export function toHalfWidth(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

const Q_HEAD = /^[第\s]*([0-9]{1,3})\s*問/;
const Q_HEAD_ALT = /^問\s*([0-9]{1,3})[^0-9]?/;
// 選択肢: "1 ..." "1. ..." "１、..." "ア ..." など
const CHOICE_NUM = /^([1-5])\s*[.．、,，)）:：]?\s*(.*)$/;
const CHOICE_KANA = /^([アイウエオ])\s*[.．、,，)）:：]?\s*(.*)$/;
const KANA_INDEX: Record<string, number> = { ア: 1, イ: 2, ウ: 3, エ: 4, オ: 5 };

interface HeadMatch {
  number: number;
  rest: string;
}

export function matchQuestionHead(line: string): HeadMatch | null {
  const t = toHalfWidth(line.trim());
  let m = t.match(Q_HEAD);
  if (m) return { number: parseInt(m[1], 10), rest: t.slice(m[0].length).trim() };
  m = t.match(Q_HEAD_ALT);
  if (m) return { number: parseInt(m[1], 10), rest: t.slice(m[0].length).trim() };
  return null;
}

interface ChoiceMatch {
  index: number; // 1-5
  text: string;
}

export function matchChoice(line: string): ChoiceMatch | null {
  const t = toHalfWidth(line.trim());
  let m = t.match(CHOICE_NUM);
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
