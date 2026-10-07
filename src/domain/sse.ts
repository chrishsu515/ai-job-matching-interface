import { AppError } from "./errors";
// 持續推送解析器接受分片、中文跨位元組及多行事件；不解析半段資料。
export async function* sseFrames(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (buffer.length > 1024 * 1024)
        throw new AppError("STREAM_TOO_LARGE", "模型串流超過安全大小。", 502);
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") yield data;
      }
      if (done) break;
    }
    if (buffer.trim())
      throw new AppError(
        "STREAM_INTERRUPTED",
        "串流未完整結束，請查原執行。",
        502,
      );
  } finally {
    reader.releaseLock();
  }
}
