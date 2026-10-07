# AI 求職配對介面

- 本專案是個人本機作品，範圍為 Next.js（網頁全端框架）、React（介面元件）、TypeScript（型別檢查）、SQLite（本機資料庫）及 xAI（模型服務）；不公開部署。
- 完整已確認方案見 docs/IMPLEMENTATION_PLAN.md（實作計畫），進度及驗收見 docs/STATUS.md（狀態報告）。
- .env（本機設定檔）為唯一模型設定來源；金鑰不得進入前端、資料庫、日誌、影片或版本控制。
- 固定範例不能替代真實模型驗收。資料版本、引用及人工確認由程式決定；模型只能提案。
- 原始事實與改寫分開保存；已接受改寫不能升格成新的事實證據。
- 視覺依 frontend-design（網頁設計技能）與 web-visual-redesign-review（實際畫面驗收技能）評審；用系統瀏覽器驗收。
- 本案不設金額上限；維持單一模型並行、有界重試與逐次費用紀錄。
- 每個程式檔少於 1000 行。測試使用 npm test、npm run test:e2e、npm run typecheck、npm run lint 及 npm run build（對應單元、瀏覽器、型別、靜態檢查與建置）。

- 本機安裝的框架文件位於 node_modules/next/dist/docs/（相符版本官方指南）；修改框架行為前先讀對應文件。next.config.ts（框架設定）關閉自動覆寫代理規則。
