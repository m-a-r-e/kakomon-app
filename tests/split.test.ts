import { planLineSplits } from "../src/engine/image-utils";

let pass = 0, fail = 0;
function ok(cond: boolean, label: string, detail = "") {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${label}${detail ? `\n  ${detail}` : ""}`); }
}

/**
 * 文字を「インクの塊」、文字間を「空白」として、行画像を合成する。
 * charW ごとに gap 幅の空白を空ける。
 */
function makeLine(charCount: number, h: number, charW: number, gap: number) {
  const width = charCount * (charW + gap);
  const data = new Uint8ClampedArray(width * h * 4).fill(255);
  for (let c = 0; c < charCount; c++) {
    const x0 = c * (charW + gap);
    for (let x = x0; x < x0 + charW; x++) {
      for (let y = 1; y < h - 1; y++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0; // 黒
        data[i + 3] = 255;
      }
    }
  }
  return { width, height: h, data };
}

// 短い行(選択肢相当)は分割しない
const short = makeLine(7, 20, 18, 4);
ok(planLineSplits(short).length === 1, "短い行は分割しない",
  `aspect=${(short.width / short.height).toFixed(1)} parts=${planLineSplits(short).length}`);

// 長い行(本文相当)は複数に分割する
const long = makeLine(40, 20, 18, 4);
const parts = planLineSplits(long);
ok(parts.length > 1, "長い行は分割する", `parts=${parts.length}`);
ok(parts.length === Math.ceil((long.width / long.height) / 14), "分割数は目標アスペクトから決まる",
  `aspect=${(long.width / long.height).toFixed(1)} parts=${parts.length}`);

// 分割は元の幅を過不足なく覆う
const covered = parts.reduce((s, p) => s + p.w, 0);
ok(covered === long.width, "分割が元の幅を覆う", `covered=${covered} width=${long.width}`);
let cursor = 0;
ok(parts.every((p) => { const okp = p.x === cursor; cursor += p.w; return okp; }),
  "分割が隙間なく連続する");

// 切れ目が文字の中ではなく空白に来る
const period = 18 + 4;
const inGap = parts.slice(1).every((p) => (p.x % period) >= 18 - 1);
ok(inGap, "切れ目が文字間の空白に来る",
  `cuts=${parts.slice(1).map((p) => `${p.x}(mod ${p.x % period})`).join(", ")}`);

// 異常な入力でも落ちない
ok(planLineSplits({ width: 0, height: 0, data: new Uint8ClampedArray(0) }).length === 1,
  "空画像でも1件を返す");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
