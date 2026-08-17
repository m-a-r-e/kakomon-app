/**
 * questions.json + questions.csv + figures/*.png を1つのzipにまとめてダウンロード。
 */
import { zipSync, type Zippable } from "fflate";
import type { QuestionRecord } from "./db";

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

export function questionsToCsv(qs: QuestionRecord[], figureNames: Map<string, string[]>): string {
  const header = [
    "id", "year", "number", "category", "question",
    "choice1", "choice2", "choice3", "choice4", "choice5",
    "answer", "figures", "note",
  ];
  const rows = qs.map((q) => {
    const figs = (figureNames.get(q.id) ?? []).join(";");
    return [
      q.id,
      q.year?.toString() ?? "",
      q.number?.toString() ?? "",
      q.category,
      q.question,
      ...[0, 1, 2, 3, 4].map((i) => q.choices[i] ?? ""),
      q.answer?.toString() ?? "",
      figs,
      q.note,
    ].map(csvEscape).join(",");
  });
  return "\uFEFF" + [header.join(","), ...rows].join("\r\n"); // BOM付き(Excel対策)
}

export async function buildExportZip(qs: QuestionRecord[]): Promise<Blob> {
  const files: Zippable = {};
  const figureNames = new Map<string, string[]>();

  for (const q of qs) {
    const names: string[] = [];
    for (let i = 0; i < q.figures.length; i++) {
      const name = `figures/${q.id}-${i + 1}.png`;
      const buf = new Uint8Array(await q.figures[i].blob.arrayBuffer());
      files[name] = buf;
      names.push(name);
    }
    figureNames.set(q.id, names);
  }

  const json = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    questions: qs.map((q) => ({
      id: q.id,
      year: q.year,
      number: q.number,
      category: q.category,
      question: q.question,
      choices: q.choices,
      answer: q.answer,
      figures: figureNames.get(q.id) ?? [],
      note: q.note,
      source_page_ids: q.sourcePageIds,
    })),
  };

  files["questions.json"] = new TextEncoder().encode(JSON.stringify(json, null, 2));
  files["questions.csv"] = new TextEncoder().encode(questionsToCsv(qs, figureNames));

  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: "application/zip" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
