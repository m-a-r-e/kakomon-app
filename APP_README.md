# 過去問取込帳(kakomon.html)

過去問集の撮影写真から、文字はテキスト・図は画像として抽出し、
questions.json / questions.csv / figures/*.png のzipを書き出すオフラインPWA。
文字認識は ndlocr-lite-wasm(NDLOCR軽量版 / CC BY 4.0)をそのまま利用し、
すべての処理が端末内で完結する(画像の外部送信なし)。

## 使い方
1. **取り込み**: 写真を複数選択 →「認識を開始」。1ページずつ順番に処理される
   (初回のみモデル50MBをダウンロード。以後は端末にキャッシュ)
2. **確認**: 認識済みページをタップ → 問題ごとに文面を修正、年度・分野・正解を入力。
   図がある問題は「図を切り抜く」→ 画像上をドラッグ →「この問題を確定」
3. **書き出し**: 確定済みの全問題をzipでダウンロード

## デプロイ(スマホのみで完結)
1. このリポジトリをGitHubに置く(上流のfork + 本パッチ適用)
2. リポジトリの Settings → Pages → Source を **GitHub Actions** に変更
3. mainにpushすると自動でビルド・公開される
4. 公開URLの `kakomon.html` を開き、Chromeメニューから「ホーム画面に追加」

※Cloudflare Pagesは1ファイル25MB制限のためモデル(40MB)が置けない。GitHub Pages推奨。

## 開発
- `npm run dev` → http://localhost:6174/kakomon.html
- テスト: `npx tsx tests/parser.test.ts && npx tsx tests/export.test.ts`
- 元のOCRデモ(index.html)には手を加えていない

## 構成(追加分)
- `kakomon.html` / `src/kakomon/` … アプリ本体(main / parser / db / export / styles)
- `public/manifest.webmanifest` `public/sw.js` `public/icon-*.png` … PWA
- `.github/workflows/deploy.yml` … GitHub Pages自動デプロイ
- `tests/` … パーサとエクスポートのテスト
