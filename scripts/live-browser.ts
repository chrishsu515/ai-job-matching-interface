import { recordWorkflow } from "./recording-flow";
// 本入口會付費；僅在隔離的全新合成資料庫錄影，不操作日常工作區。
await recordWorkflow("real");
