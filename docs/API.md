# 本機後端介面

所有入口均為同源 /api（應用程式介面）路徑，禁止外部跨來源寫入。工作台或設定讀取會建立本機工作階段。資料與錯誤回應不快取。錯誤使用 code（穩定代碼）及 message（繁體中文說明），不含供應商金鑰或完整原文。

| 方法與路徑 | 輸入及輸出 |
|---|---|
| GET /api/workspace（工作區） | 文件、版本、核對、分析、提案、修訂、執行摘要及整批逐筆狀態 |
| GET /api/settings（設定） | 模式、模型、費率、是否完整；沒有金鑰 |
| POST /api/seed（合成範例） | 建立合成履歷與三個職缺；提供防重複代碼 |
| POST /api/documents（新增文件） | 文件類型、名稱、原文、排除段落、保存同意 |
| GET /api/documents/id（讀文件） | 不可變來源及目前版本 |
| PUT /api/documents/id（更新文件） | 新文件內容與預期修訂號；建立新原文版本 |
| DELETE /api/documents/id（刪文件） | 刪除文件及依賴結果，保留無內容的用量 |
| GET /api/jobs（職缺） | 職缺清單，搜尋與篩選在前端一般程式完成 |
| PATCH /api/jobs/id（收藏） | 預期修訂號與收藏決定 |
| GET /api/reviews/id（核對內容） | 已保存的解析與人工修正 |
| POST /api/reviews（自行核對） | 文件識別碼，建立無模型結果的人工草稿；有來源項目由使用者新增 |
| PUT /api/reviews/id（保存核對） | 預期核對版、項目及確認決定，來源須有效 |
| POST /api/preview（傳送預覽） | 與模型任務相同輸入，回傳實際可送範圍，不呼叫模型 |
| POST /api/batches（整批啟動） | resumeId（履歷識別碼）；取啟動時全部職缺快照，需防重複代碼，回傳已保存批次 |
| POST /api/batches/id/cancel（整批取消） | 取消當前及尚未開始項目，保留已完成結果 |
| POST /api/runs（啟動） | 任務、文件或履歷／職缺／段落識別碼；串流阶段事件 |
| GET /api/runs/id（查執行） | 查原執行，沒有新請求 |
| POST /api/runs/id/cancel（取消） | 中止本機及上游連線 |
| POST /api/rewrites/id/accept（接受） | 預期來源版本；驗證通過及版本相符才交易保存 |
| POST /api/rewrites/id/reject（拒絕） | 原提案版本，沒有模型請求 |
| POST /api/resume-revisions/id/restore（還原） | 目前修訂識別碼，新增還原修訂 |
| GET /api/usage（用量） | 每次真實請求、未知用量及實際／估算費用 |
| DELETE /api/local-data（清除） | 輸入確認文字「清除」，決定是否包含用量 |

啟動、新增、範例、自行核對、接受／拒絕及還原需 Idempotency-Key（防重複操作代碼），同代碼同內容回原結果，同代碼不同內容回衝突。版本衝突不自動覆寫。

串流事件含 started（開始）、stage（實際階段）、completed（完整已驗證結果）、error（失敗）、cancelled（取消）。結果在完成前不提供可接受內容。JSON（資料格式）內容先完整緩衝；心跳只是連線維持，不是完成百分比。
