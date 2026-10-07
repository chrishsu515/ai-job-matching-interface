export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryable = false,
  ) {
    super(message);
  }
}
export function requireCondition(
  condition: unknown,
  code: string,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new AppError(code, message, status);
}
export function publicError(error: unknown) {
  if (error instanceof AppError)
    return { code: error.code, message: error.message, status: error.status };
  return {
    code: "INTERNAL",
    message: "處理失敗，資料未套用；請重新整理或查看原執行。",
    status: 500,
  };
}
