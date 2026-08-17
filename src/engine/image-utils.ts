/**
 * Decode an image (File/Blob) into an ImageData.
 */
export async function decodeImage(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Pad an image to a square (max side) and resize to targetSize x targetSize.
 * Returns RGBA ImageData.
 */
export function padAndResize(
  src: ImageData,
  targetSize: number,
): ImageData {
  const maxSide = Math.max(src.width, src.height);
  // Create padded square canvas
  const padCanvas = new OffscreenCanvas(maxSide, maxSide);
  const padCtx = padCanvas.getContext("2d")!;
  padCtx.fillStyle = "#000";
  padCtx.fillRect(0, 0, maxSide, maxSide);
  padCtx.putImageData(src, 0, 0);

  // Resize to target
  const outCanvas = new OffscreenCanvas(targetSize, targetSize);
  const outCtx = outCanvas.getContext("2d")!;
  outCtx.drawImage(padCanvas, 0, 0, targetSize, targetSize);
  return outCtx.getImageData(0, 0, targetSize, targetSize);
}

/**
 * Crop a region from an ImageData.
 */
export function cropImageData(
  src: ImageData,
  x: number,
  y: number,
  w: number,
  h: number,
): ImageData {
  // Clamp to image bounds
  const x0 = Math.max(0, Math.min(x, src.width));
  const y0 = Math.max(0, Math.min(y, src.height));
  const x1 = Math.max(0, Math.min(x + w, src.width));
  const y1 = Math.max(0, Math.min(y + h, src.height));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw <= 0 || ch <= 0) {
    return new ImageData(1, 1);
  }
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext("2d")!;
  // Use putImageData with source offsets
  const srcCanvas = new OffscreenCanvas(src.width, src.height);
  const srcCtx = srcCanvas.getContext("2d")!;
  srcCtx.putImageData(src, 0, 0);
  ctx.drawImage(srcCanvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return ctx.getImageData(0, 0, cw, ch);
}

/**
 * Resize an ImageData to target width/height.
 * If height > width, rotates 90 degrees first (for PARSeq).
 */
export function resizeForParseq(
  src: ImageData,
  targetW: number,
  targetH: number,
  rotateIfVertical: boolean = true,
): ImageData {
  let sourceCanvas = new OffscreenCanvas(src.width, src.height);
  let sourceCtx = sourceCanvas.getContext("2d")!;
  sourceCtx.putImageData(src, 0, 0);

  let drawSource: OffscreenCanvas = sourceCanvas;

  if (rotateIfVertical && src.height > src.width) {
    // Rotate 90 degrees
    const rotCanvas = new OffscreenCanvas(src.height, src.width);
    const rotCtx = rotCanvas.getContext("2d")!;
    rotCtx.translate(src.height, 0);
    rotCtx.rotate(Math.PI / 2);
    rotCtx.drawImage(sourceCanvas, 0, 0);
    drawSource = rotCanvas;
  }

  const outCanvas = new OffscreenCanvas(targetW, targetH);
  const outCtx = outCanvas.getContext("2d")!;
  outCtx.drawImage(drawSource, 0, 0, targetW, targetH);
  return outCtx.getImageData(0, 0, targetW, targetH);
}

/**
 * 長い行を横方向に分割する位置を決める。
 *
 * PARSeqの入力は 768x16 固定で、resizeForParseq はアスペクト比を保たず引き伸ばす。
 * そのため1行が長いほど1文字あたりの横解像度が落ちる(40文字なら約19px、
 * 7文字なら約110px)。長い行だけを分割して個別に認識させることで、
 * 本文の横解像度を短い行と同程度まで戻す。
 *
 * 分割位置は「インクの少ない列」を選び、文字の途中で切らないようにする。
 * OffscreenCanvas を使わないので単体テストできる。
 */
export function planLineSplits(
  src: { width: number; height: number; data: Uint8ClampedArray },
  splitAboveAspect = 20,
  targetAspect = 14,
): { x: number; w: number }[] {
  const w = src.width, h = src.height;
  const whole = [{ x: 0, w }];
  if (w <= 0 || h <= 0) return whole;
  const aspect = w / h;
  if (aspect <= splitAboveAspect) return whole;

  const n = Math.ceil(aspect / targetAspect);
  if (n <= 1) return whole;

  // 列ごとのインク量(暗さの合計)
  const ink = new Float32Array(w);
  const d = src.data;
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      s += 255 - (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    }
    ink[x] = s;
  }

  // 等分位置の周辺で最もインクが薄い列を切れ目にする
  const step = w / n;
  const win = Math.max(1, Math.round(step * 0.2));
  const cuts: number[] = [];
  for (let i = 1; i < n; i++) {
    const center = Math.round(step * i);
    let best = center, bestInk = Infinity;
    const from = Math.max(1, center - win), to = Math.min(w - 1, center + win);
    for (let x = from; x <= to; x++) {
      if (ink[x] < bestInk) { bestInk = ink[x]; best = x; }
    }
    cuts.push(best);
  }

  const ranges: { x: number; w: number }[] = [];
  let prev = 0;
  for (const c of cuts) {
    if (c > prev) { ranges.push({ x: prev, w: c - prev }); prev = c; }
  }
  if (w > prev) ranges.push({ x: prev, w: w - prev });
  return ranges.length ? ranges : whole;
}
