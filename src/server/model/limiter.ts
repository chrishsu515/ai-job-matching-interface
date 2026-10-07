import { requireCondition } from "@/domain/errors";
const root = globalThis as typeof globalThis & { modelCallTimes?: number[] };
export function callWaitMs(maximum: number) {
  const recent = (root.modelCallTimes || []).filter(
    (t) => Date.now() - t < 60000,
  );
  return recent.length >= maximum
    ? Math.max(0, 60100 - (Date.now() - recent[0]))
    : 0;
}
export function reserveCall(maximum: number) {
  root.modelCallTimes = (root.modelCallTimes || []).filter(
    (t) => Date.now() - t < 60000,
  );
  requireCondition(
    root.modelCallTimes.length < maximum,
    "LOCAL_RATE_LIMIT",
    "本機每分鐘模型呼叫已達上限，請稍後再試。",
    429,
  );
  root.modelCallTimes.push(Date.now());
}
