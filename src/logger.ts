export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

let traceCounter = 0;

export function generateTraceId(): string {
  traceCounter += 1;
  return `t-${Date.now().toString(36)}-${traceCounter.toString(36)}`;
}

export function createLogger(level: LogLevel, baseContext: Record<string, unknown> = {}): Logger {
  const write = (entryLevel: LogLevel, message: string, data?: Record<string, unknown>): void => {
    if (LEVEL_PRIORITY[entryLevel] < LEVEL_PRIORITY[level]) {
      return;
    }

    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: entryLevel,
      message,
      ...baseContext,
      ...(data ?? {}),
    });

    process.stderr.write(`${line}\n`);
  };

  const logger: Logger = {
    debug: (message, data) => write("debug", message, data),
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data),
    child: (context) => createLogger(level, { ...baseContext, ...context }),
  };

  return logger;
}
