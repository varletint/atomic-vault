type LogLevel = "info" | "warn" | "error" | "debug";

type LogMeta = Record<string, unknown>;

function write(level: LogLevel, message: string, meta?: LogMeta): void {
  const payload: Record<string, unknown> = {
    level,
    message,
    ts: new Date().toISOString(),
  };
  if (meta && Object.keys(meta).length > 0) payload.meta = meta;
  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info(message: string, meta?: LogMeta): void {
    write("info", message, meta);
  },
  warn(message: string, meta?: LogMeta): void {
    write("warn", message, meta);
  },
  error(message: string, meta?: LogMeta): void {
    write("error", message, meta);
  },
  debug(message: string, meta?: LogMeta): void {
    if (process.env.NODE_ENV !== "production") write("debug", message, meta);
  },
};

