# AI 求職配對介面

個人作品：貼上履歷與職缺，核對逐項條件、原文證據及可還原的履歷改寫。僅在本機執行。

## 技術棧

Next.js（網頁全端框架）、React（介面元件）、TypeScript（型別檢查）、SQLite（本機資料庫）、xAI Responses API（模型回應介面）。

## 啟動前設定

使用受支援的 Node.js（執行環境）22 系列，本案驗證版本為 22.18.0。執行 npm ci（依鎖定版本安裝），首次複製 .env.example（設定範本）為 .env（唯一設定檔）。已有設定時不要覆寫。預設固定範例，無須金鑰。真實模式將 APP_MODE（模式）設為 real（真實），並自行填寫 MODEL_API_KEY（模型金鑰）。金鑰只由伺服器讀取。瀏覽器測試使用系統 Chrome（網頁瀏覽器）。

## 啟動

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

開啟 http://localhost:3000。正式本機展示執行 npm run build（建置），再執行 npm start（啟動）；僅綁定回環位址。設定修改後重新啟動。必要驗證：npm test、npm run typecheck、npm run lint（測試、型別及靜態檢查）。

操作步驟見 docs/USER_GUIDE.md（使用指南）；功能與限制見 PROJECT_FUNCTIONS_AND_WORKFLOWS.md（功能與流程主檔），驗收狀態見 docs/STATUS.md（狀態報告）。

觀看已錄製的展示與真實模型影片：執行 npx tsx scripts/serve-recordings.ts（本機影片服務），開啟 http://localhost:3003。播放影片不呼叫模型。
