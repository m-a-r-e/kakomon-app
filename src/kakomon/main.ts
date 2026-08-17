import "./styles.css";
import { db, uid, type PageRecord, type QuestionRecord, type FigureRecord } from "./db";
import { parseLines, type OcrLine, type QuestionDraft } from "./parser";
import { buildExportZip, downloadBlob } from "./export";
import type { WorkerResponse } from "../worker/ocr.worker";

const CATEGORIES = [
  "", "誕生・歴史", "インテリア計画", "構造・工法", "内装材・仕上げ", "色彩",
  "照明", "家具", "ファブリックス", "住宅設備", "法規・制度", "販売・接客", "その他",
];

const view = document.getElementById("view")!;
const tabs = [...document.querySelectorAll<HTMLButtonElement>("nav.tabs button")];
let currentTab = "import";

// ---------- 設定(localStorage) ----------
const settings = {
  get preset(): string { return localStorage.getItem("kk-preset") ?? "lite"; },
  set preset(v: string) { localStorage.setItem("kk-preset", v); },
  get year(): string { return localStorage.getItem("kk-year") ?? ""; },
  set year(v: string) { localStorage.setItem("kk-year", v); },
};

// ---------- OCRキュー ----------
type QueueState = {
  running: boolean;
  currentPageId: string | null;
  stage: string;
  detail: string;
  ratio: number; // 0-1 現在ページ内
};
const queue: QueueState = { running: false, currentPageId: null, stage: "", detail: "", ratio: 0 };

let worker: Worker | null = null;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../worker/ocr.worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

function runOcrOnPage(page: PageRecord): Promise<OcrLine[]> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const onMsg = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      switch (m.type) {
        case "init-progress":
          queue.stage = "モデル読込";
          queue.detail = m.model;
          queue.ratio = m.total ? m.loaded / m.total : 0;
          break;
        case "init-done":
          queue.stage = "検出中";
          queue.detail = "";
          queue.ratio = 0;
          break;
        case "detect-done":
          queue.stage = "文字認識";
          queue.detail = `${m.numDetections}行を検出`;
          queue.ratio = 0;
          break;
        case "recognize-progress":
          queue.stage = "文字認識";
          queue.detail = `${m.current} / ${m.total} 行`;
          queue.ratio = m.total ? m.current / m.total : 0;
          break;
        case "result":
          w.removeEventListener("message", onMsg);
          resolve(m.lines);
          return;
        case "error":
          w.removeEventListener("message", onMsg);
          reject(new Error(m.message));
          return;
      }
      if (currentTab === "import") renderQueueProgress();
    };
    w.addEventListener("message", onMsg);
    w.postMessage({ type: "run", imageBlob: page.blob, presetId: settings.preset });
  });
}

async function processQueue(): Promise<void> {
  if (queue.running) return;
  queue.running = true;
  try {
    for (;;) {
      const pages = (await db.allPages()).filter((p) => p.status === "pending");
      if (pages.length === 0) break;
      pages.sort((a, b) => a.createdAt - b.createdAt);
      const page = pages[0];
      queue.currentPageId = page.id;
      queue.stage = "準備中";
      queue.detail = page.name;
      queue.ratio = 0;
      if (currentTab === "import") render();
      try {
        const lines = await runOcrOnPage(page);
        page.ocrLines = lines;
        page.status = "ocr_done";
        delete page.error;
      } catch (e) {
        page.status = "error";
        page.error = e instanceof Error ? e.message : String(e);
      }
      await db.putPage(page);
      if (currentTab === "import") render();
      updateCounts();
    }
  } finally {
    queue.running = false;
    queue.currentPageId = null;
    if (currentTab === "import") render();
  }
}

// ---------- 共通 ----------
function el(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

const STAMP_LABEL: Record<string, string> = {
  pending: "未", ocr_done: "認", reviewed: "済", error: "誤",
};

async function updateCounts(): Promise<void> {
  const pages = await db.allPages();
  const qs = await db.allQuestions();
  const pending = pages.filter((p) => p.status === "pending" || p.status === "error").length;
  const toReview = pages.filter((p) => p.status === "ocr_done").length;
  document.getElementById("c-import")!.textContent = pending ? String(pending) : "";
  document.getElementById("c-review")!.textContent = toReview ? String(toReview) : "";
  document.getElementById("c-export")!.textContent = qs.length ? String(qs.length) : "";
}

// ---------- 取り込みタブ ----------
async function renderImport(): Promise<void> {
  const pages = await db.allPages();
  pages.sort((a, b) => a.createdAt - b.createdAt);
  const pending = pages.filter((p) => p.status === "pending").length;

  view.innerHTML = "";
  view.append(
    el(`<label class="filebtn ghost">写真を選ぶ(複数可)<input type="file" accept="image/*" multiple></label>`),
  );
  view.querySelector("input[type=file]")!.addEventListener("change", async (e) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])];
    let t = Date.now();
    for (const f of files) {
      await db.putPage({
        id: uid(), name: f.name, blob: f, status: "pending", createdAt: t++,
      });
    }
    (e.target as HTMLInputElement).value = "";
    await render();
    updateCounts();
  });

  const presetRow = el(`
    <div class="field" style="margin-top:12px">
      <label for="preset">認識モデル(初回のみダウンロード・以後は端末に保存)</label>
      <select id="preset">
        <option value="lite">軽量 (50MB・高速)</option>
        <option value="standard">標準 (77MB・高精度)</option>
      </select>
    </div>`);
  const sel = presetRow.querySelector("select")!;
  sel.value = settings.preset;
  sel.addEventListener("change", () => (settings.preset = sel.value));
  view.append(presetRow);

  const startBtn = el(
    `<button class="primary" ${pending === 0 || queue.running ? "disabled" : ""}>認識を開始(${pending}枚)</button>`,
  );
  startBtn.addEventListener("click", () => processQueue());
  view.append(startBtn);

  view.append(el(`<div id="qprog"></div>`));
  renderQueueProgress();

  if (pages.length === 0) {
    view.append(el(`<div class="empty">まだページがありません。<br>過去問を1ページずつ、影を避けて撮影してください。</div>`));
  } else {
    const ul = el(`<ul class="rows"></ul>`);
    for (const p of pages) {
      const li = el(`
        <li>
          <span class="stamp" data-s="${p.status}">${STAMP_LABEL[p.status]}</span>
          <img class="thumb" alt="">
          <div class="grow">
            <div class="name">${escapeHtml(p.name)}</div>
            <div class="meta">${p.status === "error" ? escapeHtml(p.error ?? "エラー") : statusText(p)}</div>
          </div>
          <button class="ghost small" data-act="del" aria-label="削除">削除</button>
        </li>`);
      const img = li.querySelector("img")!;
      img.src = URL.createObjectURL(p.blob);
      img.addEventListener("load", () => URL.revokeObjectURL(img.src), { once: true });
      li.querySelector("[data-act=del]")!.addEventListener("click", async () => {
        if (!confirm(`「${p.name}」を削除しますか?`)) return;
        await db.deletePage(p.id);
        render(); updateCounts();
      });
      ul.append(li);
    }
    view.append(ul);
  }
  view.append(el(`<div class="notice">文字認識: <a href="https://github.com/tamoco-mocomoco/ndlocr-lite-wasm" target="_blank" rel="noopener">ndlocr-lite-wasm</a>(NDLOCR軽量版 / CC BY 4.0)</div>`));
}

function statusText(p: PageRecord): string {
  if (p.status === "pending") return "認識待ち";
  if (p.status === "ocr_done") return `${p.ocrLines?.length ?? 0}行 認識済み → 確認タブへ`;
  if (p.status === "reviewed") return "確定済み";
  return "";
}

function renderQueueProgress(): void {
  const box = document.getElementById("qprog");
  if (!box) return;
  if (!queue.running) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="progress-label">${escapeHtml(queue.stage)} ${escapeHtml(queue.detail)}</div>
    <div class="progress"><div style="width:${Math.round(queue.ratio * 100)}%"></div></div>`;
}

// ---------- 確認(レビュー)タブ ----------
let reviewPageId: string | null = null;

async function renderReview(): Promise<void> {
  if (reviewPageId) return renderReviewEditor(reviewPageId);
  const pages = (await db.allPages()).filter((p) => p.status === "ocr_done");
  pages.sort((a, b) => a.createdAt - b.createdAt);
  view.innerHTML = "";
  if (pages.length === 0) {
    view.append(el(`<div class="empty">確認待ちのページはありません。<br>取り込みタブで認識を実行してください。</div>`));
    return;
  }
  const ul = el(`<ul class="rows"></ul>`);
  for (const p of pages) {
    const li = el(`
      <li role="button" tabindex="0">
        <span class="stamp" data-s="${p.status}">${STAMP_LABEL[p.status]}</span>
        <img class="thumb" alt="">
        <div class="grow">
          <div class="name">${escapeHtml(p.name)}</div>
          <div class="meta">${p.ocrLines?.length ?? 0}行 / タップして確認</div>
        </div>
      </li>`);
    const img = li.querySelector("img")!;
    img.src = URL.createObjectURL(p.blob);
    img.addEventListener("load", () => URL.revokeObjectURL(img.src), { once: true });
    const open = () => { reviewPageId = p.id; renderReview(); };
    li.addEventListener("click", open);
    li.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") open(); });
    ul.append(li);
  }
  view.append(ul);
}

interface CropState {
  active: boolean;
  targetCard: HTMLElement | null;
  start: { x: number; y: number } | null;
  rect: { x: number; y: number; w: number; h: number } | null;
}

async function renderReviewEditor(pageId: string): Promise<void> {
  const page = await db.getPage(pageId);
  if (!page) { reviewPageId = null; return renderReview(); }

  view.innerHTML = "";
  const back = el(`<button class="ghost small">← 一覧に戻る</button>`);
  back.addEventListener("click", () => { reviewPageId = null; renderReview(); });
  view.append(back);

  // 元画像 + クロップキャンバス
  const bitmap = await createImageBitmap(page.blob);
  const wrap = el(`<div class="cropwrap"><canvas></canvas></div>`);
  const canvas = wrap.querySelector("canvas")!;
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  const crop: CropState = { active: false, targetCard: null, start: null, rect: null };

  const draw = () => {
    ctx.drawImage(bitmap, 0, 0);
    if (crop.rect) {
      ctx.save();
      ctx.strokeStyle = "#c22f1f";
      ctx.lineWidth = Math.max(2, bitmap.width / 300);
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(crop.rect.x, crop.rect.y, crop.rect.w, crop.rect.h);
      ctx.restore();
    }
  };
  draw();

  const toCanvasXY = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    };
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!crop.active) return;
    canvas.setPointerCapture(e.pointerId);
    crop.start = toCanvasXY(e);
    crop.rect = null;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!crop.active || !crop.start) return;
    const p = toCanvasXY(e);
    crop.rect = {
      x: Math.min(crop.start.x, p.x),
      y: Math.min(crop.start.y, p.y),
      w: Math.abs(p.x - crop.start.x),
      h: Math.abs(p.y - crop.start.y),
    };
    draw();
  });
  canvas.addEventListener("pointerup", async () => {
    if (!crop.active || !crop.rect || !crop.targetCard) { crop.start = null; return; }
    crop.start = null;
    if (crop.rect.w < 8 || crop.rect.h < 8) { crop.rect = null; draw(); return; }
    // カラー元画像から切り抜き → PNG
    const c = document.createElement("canvas");
    c.width = Math.round(crop.rect.w);
    c.height = Math.round(crop.rect.h);
    c.getContext("2d")!.drawImage(
      bitmap, crop.rect.x, crop.rect.y, crop.rect.w, crop.rect.h,
      0, 0, c.width, c.height,
    );
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
    addFigureToCard(crop.targetCard, { id: uid(), blob });
    crop.active = false;
    crop.targetCard = null;
    crop.rect = null;
    wrap.classList.remove("cropping");
    draw();
    hint.textContent = "";
  });

  const hint = el(`<div class="crophint" role="status"></div>`);
  view.append(wrap, hint);

  // 年度(このページの既定値)
  const yearRow = el(`
    <div class="field">
      <label for="pgyear">年度(このページの問題すべてに適用)</label>
      <input id="pgyear" type="number" inputmode="numeric" placeholder="例: 2023" value="${escapeHtml(settings.year)}">
    </div>`);
  const yearInput = yearRow.querySelector("input")!;
  yearInput.addEventListener("change", () => (settings.year = yearInput.value));
  view.append(yearRow);

  // 問題ドラフト
  const drafts = parseLines(page.ocrLines ?? []);
  const cardsBox = el(`<div></div>`);
  for (const d of drafts) cardsBox.append(buildQuestionCard(d, page, crop, hint, canvas));
  view.append(cardsBox);

  const addBtn = el(`<button class="ghost">+ 問題を手動で追加</button>`);
  addBtn.addEventListener("click", () => {
    cardsBox.append(buildQuestionCard(
      { number: null, question: "", choices: ["", "", "", "", ""], rawText: "" },
      page, crop, hint, canvas,
    ));
  });
  view.append(addBtn);

  const doneBtn = el(`<button class="primary" style="margin-top:14px">このページを確認済みにする</button>`);
  doneBtn.addEventListener("click", async () => {
    const unconfirmed = cardsBox.querySelectorAll(".qcard:not(.confirmed)").length;
    if (unconfirmed > 0 && !confirm(`未確定の問題が${unconfirmed}件あります。破棄してページを確認済みにしますか?`)) return;
    page.status = "reviewed";
    await db.putPage(page);
    reviewPageId = null;
    renderReview();
    updateCounts();
  });
  view.append(doneBtn);
}

function buildQuestionCard(
  d: QuestionDraft,
  page: PageRecord,
  crop: CropState,
  hint: HTMLElement,
  canvas: HTMLCanvasElement,
): HTMLElement {
  const figures: FigureRecord[] = [];
  const card = el(`
    <section class="qcard">
      <h3><span>問題</span><span class="stamp" data-s="pending" aria-hidden="true">未</span></h3>
      <div class="field-inline">
        <div class="field"><label>問題番号</label><input data-f="number" type="number" inputmode="numeric" value="${d.number ?? ""}"></div>
        <div class="field"><label>正解(1-5)</label>
          <select data-f="answer"><option value="">未設定</option>${[1,2,3,4,5].map((n)=>`<option>${n}</option>`).join("")}</select>
        </div>
      </div>
      <div class="field"><label>分野</label>
        <select data-f="category">${CATEGORIES.map((c)=>`<option value="${c}">${c || "未分類"}</option>`).join("")}</select>
      </div>
      <div class="field"><label>問題文</label><textarea data-f="question">${escapeHtml(d.question)}</textarea></div>
      <div data-choices>
        ${[0,1,2,3,4].map((i)=>`
          <div class="choice-row">
            <span class="num">${i+1}</span>
            <input data-choice="${i}" value="${escapeHtml(d.choices[i] ?? "")}" placeholder="選択肢${i+1}">
          </div>`).join("")}
      </div>
      <details class="raw"><summary>認識した元テキストを表示</summary><pre>${escapeHtml(d.rawText)}</pre></details>
      <div class="figs" data-figs></div>
      <div class="btnrow">
        <button class="ghost small" data-act="crop">図を切り抜く</button>
        <button class="primary small" data-act="save">この問題を確定</button>
      </div>
      <div class="field"><label>メモ</label><input data-f="note" placeholder="補足があれば"></div>
    </section>`);

  card.querySelector("[data-act=crop]")!.addEventListener("click", () => {
    crop.active = true;
    crop.targetCard = card;
    canvas.parentElement!.classList.add("cropping");
    hint.textContent = "上の画像を指でドラッグして、図の範囲を囲ってください";
    canvas.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  (card as HTMLElement & { _figures?: FigureRecord[] })._figures = figures;

  card.querySelector("[data-act=save]")!.addEventListener("click", async () => {
    const get = (f: string) => (card.querySelector(`[data-f=${f}]`) as HTMLInputElement).value.trim();
    const number = get("number") ? parseInt(get("number"), 10) : null;
    const yearStr = (document.getElementById("pgyear") as HTMLInputElement | null)?.value.trim() ?? "";
    const year = yearStr ? parseInt(yearStr, 10) : null;
    const question = (card.querySelector("[data-f=question]") as HTMLTextAreaElement).value.trim();
    if (!question) { alert("問題文が空です"); return; }
    const choices = [0,1,2,3,4].map((i) =>
      (card.querySelector(`[data-choice="${i}"]`) as HTMLInputElement).value.trim());
    const answerStr = get("answer");
    const baseId = `${year ?? "y"}-q${number ?? "x"}`;
    let id = baseId;
    for (let n = 2; await db.getQuestion(id); n++) id = `${baseId}-${n}`;
    const rec: QuestionRecord = {
      id, year, number,
      category: get("category"),
      question, choices,
      answer: answerStr ? parseInt(answerStr, 10) : null,
      figures: [...figures],
      note: get("note"),
      sourcePageIds: [page.id],
      createdAt: Date.now(),
    };
    await db.putQuestion(rec);
    card.classList.add("confirmed");
    const st = card.querySelector(".stamp")!;
    st.setAttribute("data-s", "reviewed");
    st.textContent = "済";
    (card.querySelector("[data-act=save]") as HTMLButtonElement).disabled = true;
    updateCounts();
  });

  return card;
}

function addFigureToCard(card: HTMLElement, fig: FigureRecord): void {
  const figures = (card as HTMLElement & { _figures?: FigureRecord[] })._figures!;
  figures.push(fig);
  const box = card.querySelector("[data-figs]")!;
  const item = el(`<div class="fig"><img alt="切り抜いた図"><button aria-label="図を削除">×</button></div>`);
  const img = item.querySelector("img")!;
  img.src = URL.createObjectURL(fig.blob);
  item.querySelector("button")!.addEventListener("click", () => {
    const i = figures.indexOf(fig);
    if (i >= 0) figures.splice(i, 1);
    URL.revokeObjectURL(img.src);
    item.remove();
  });
  box.append(item);
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- 書き出しタブ ----------
async function renderExport(): Promise<void> {
  const qs = await db.allQuestions();
  qs.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.number ?? 0) - (b.number ?? 0));
  view.innerHTML = "";
  if (qs.length === 0) {
    view.append(el(`<div class="empty">確定した問題がまだありません。</div>`));
    return;
  }
  const figCount = qs.reduce((n, q) => n + q.figures.length, 0);
  view.append(el(`<p>確定済み <strong>${qs.length}問</strong> / 図 ${figCount}枚</p>`));

  const btn = el(`<button class="primary">zipを書き出す(questions.json / csv / figures)</button>`);
  btn.addEventListener("click", async () => {
    btn.setAttribute("disabled", "");
    btn.textContent = "作成中…";
    try {
      const blob = await buildExportZip(qs);
      const d = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `kakomon-${d}.zip`);
    } finally {
      btn.removeAttribute("disabled");
      btn.textContent = "zipを書き出す(questions.json / csv / figures)";
    }
  });
  view.append(btn);

  const ul = el(`<ul class="rows" style="margin-top:16px"></ul>`);
  for (const q of qs) {
    const li = el(`
      <li>
        <span class="stamp" data-s="reviewed">済</span>
        <div class="grow">
          <div class="name">${q.year ?? "?"}年 第${q.number ?? "?"}問 ${escapeHtml(q.category || "未分類")}</div>
          <div class="meta">${escapeHtml(q.question.slice(0, 40))}${q.question.length > 40 ? "…" : ""}</div>
        </div>
        <button class="ghost small">削除</button>
      </li>`);
    li.querySelector("button")!.addEventListener("click", async () => {
      if (!confirm(`「第${q.number}問」を削除しますか?`)) return;
      await db.deleteQuestion(q.id);
      render(); updateCounts();
    });
    ul.append(li);
  }
  view.append(ul);
}

// ---------- ルーティング ----------
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function render(): Promise<void> {
  if (currentTab === "import") await renderImport();
  else if (currentTab === "review") await renderReview();
  else await renderExport();
}

for (const b of tabs) {
  b.addEventListener("click", () => {
    currentTab = b.dataset.tab!;
    if (currentTab !== "review") reviewPageId = null;
    for (const t of tabs) t.setAttribute("aria-selected", String(t === b));
    render();
  });
}

render();
updateCounts();
