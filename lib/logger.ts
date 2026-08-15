/**
 * Minimal structured logger.
 *
 * Emits single-line JSON so Vercel/other log drains can parse it. Values that
 * commonly contain secrets or personal data are redacted by key name.
 */
type Level = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACTED_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "secret",
  "otp",
  "otpcode",
  "otphash",
  "paystacksecretkey",
  "signature",
  "matricnumber",
  "studentidnumber",
  "accountnumber",
]);

function configuredLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return (["debug", "info", "warn", "error"] as const).includes(raw as Level)
    ? (raw as Level)
    : "info";
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export type LogContext = Record<string, unknown>;

function write(level: Level, message: string, context?: LogContext) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[configuredLevel()]) return;

  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (redact(context) as LogContext) : {}),
  };

  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
  /** Returns a logger that merges `base` into every entry. */
  child(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => write("debug", m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => write("info", m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => write("warn", m, { ...base, ...c }),
      error: (m: string, c?: LogContext) => write("error", m, { ...base, ...c }),
    };
  },
};
