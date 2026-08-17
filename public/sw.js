// アプリシェルのランタイムキャッシュ + COOP/COEP付与(モデル.onnxは既存のIndexedDBキャッシュに任せる)
//
// 同一スコープに Service Worker は1つしか置けない。
// 以前は coi-serviceworker.js と この sw.js の両方を登録していたため、
// 後から登録される sw.js が COI 用のSWを追い出し、crossOriginIsolated が
// 成立せず SharedArrayBuffer が使えず、onnxruntime がシングルスレッドに
// 落ちていた。そこで COI 用のヘッダ付与をこのSWに統合している。
const CACHE = "kakomon-shell-v3";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) =>
    Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

// crossOriginIsolated を成立させるヘッダを必ず付けて返す。
// キャッシュから返す場合も通す必要がある(保存時の応答にはヘッダが無いため)
function withCoi(res) {
  if (!res || res.status === 0) return res;
  const h = new Headers(res.headers);
  h.set("Cross-Origin-Embedder-Policy", "require-corp");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const fromNetwork = (req) =>
  fetch(req).then((res) => {
    if (res.ok) {
      const clone = res.clone();
      caches.open(CACHE).then((c) => c.put(req, clone));
    }
    return withCoi(res);
  });

self.addEventListener("fetch", (e) => {
  if (e.request.cache === "only-if-cached" && e.request.mode !== "same-origin") return;
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);
  // 別オリジンとモデルはキャッシュせず、ヘッダだけ付けて素通しする
  if (url.origin !== location.origin || url.pathname.endsWith(".onnx")) {
    e.respondWith(fetch(e.request).then(withCoi));
    return;
  }

  // HTMLはネットワーク優先(更新を確実に反映させる)。オフライン時のみキャッシュへ退避
  if (e.request.mode === "navigate" || url.pathname.endsWith(".html")) {
    e.respondWith(fromNetwork(e.request).catch(() => caches.match(e.request).then(withCoi)));
    return;
  }

  e.respondWith(
    caches.match(e.request).then((hit) => (hit ? withCoi(hit) : fromNetwork(e.request)))
  );
});
