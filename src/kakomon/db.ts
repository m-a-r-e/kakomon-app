/**
 * IndexedDB: ページ台帳と確定済み問題の保存。
 * 依存なしの薄いPromiseラッパ。
 */
import type { OcrLine } from "./parser";

export type PageStatus = "pending" | "ocr_done" | "reviewed" | "error";

export interface PageRecord {
  id: string;
  name: string;
  blob: Blob;
  status: PageStatus;
  ocrLines?: OcrLine[];
  error?: string;
  createdAt: number;
}

export interface FigureRecord {
  id: string;
  blob: Blob; // PNG
}

export interface QuestionRecord {
  id: string; // e.g. "2023-q01"
  year: number | null;
  number: number | null;
  category: string;
  question: string;
  choices: string[];
  answer: number | null; // 1-5
  figures: FigureRecord[];
  note: string;
  sourcePageIds: string[];
  createdAt: number;
}

const DB_NAME = "kakomon-app";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("pages")) {
        db.createObjectStore("pages", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("questions")) {
        db.createObjectStore("questions", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const db = {
  putPage: (p: PageRecord) => tx("pages", "readwrite", (s) => s.put(p)),
  getPage: (id: string) => tx<PageRecord | undefined>("pages", "readonly", (s) => s.get(id)),
  allPages: () => tx<PageRecord[]>("pages", "readonly", (s) => s.getAll()),
  deletePage: (id: string) => tx("pages", "readwrite", (s) => s.delete(id)),

  putQuestion: (q: QuestionRecord) => tx("questions", "readwrite", (s) => s.put(q)),
  getQuestion: (id: string) =>
    tx<QuestionRecord | undefined>("questions", "readonly", (s) => s.get(id)),
  allQuestions: () => tx<QuestionRecord[]>("questions", "readonly", (s) => s.getAll()),
  deleteQuestion: (id: string) => tx("questions", "readwrite", (s) => s.delete(id)),
};

export function uid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}
