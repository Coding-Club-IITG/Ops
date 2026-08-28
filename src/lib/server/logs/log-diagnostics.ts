import { createHash } from "node:crypto";
import { z } from "zod";

export const diagnosticFrameSchema = z
  .object({
    function: z.string().max(256).optional(),
    file: z.string().min(1).max(512),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  })
  .strict();

export type DiagnosticFrame = z.infer<typeof diagnosticFrameSchema>;

export type DiagnosticCause = {
  name?: string;
  code?: string;
  message: string;
  frames: DiagnosticFrame[];
  cause?: DiagnosticCause;
};

export const diagnosticCauseSchema: z.ZodType<DiagnosticCause> = z.lazy(() =>
  z
    .object({
      name: z.string().max(128).optional(),
      code: z.string().max(128).optional(),
      message: z.string().max(2_048),
      frames: z.array(diagnosticFrameSchema).max(50),
      cause: diagnosticCauseSchema.optional(),
    })
    .strict(),
);

export const logDiagnosticSchema = z
  .object({
    message: z.string().max(2_048),
    frames: z.array(diagnosticFrameSchema).max(50),
    cause: diagnosticCauseSchema.optional(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    redactionCount: z.number().int().nonnegative(),
  })
  .strict();

export type LogDiagnostic = z.infer<typeof logDiagnosticSchema>;

const V8_FRAME = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
const REPOSITORY_MARKERS = ["/src/", "/app/", "/contracts/", "/packages/"];
const REDACTIONS: RegExp[] = [
  /\b(?:cookie|set-cookie)\b\s*[:=]\s*[^\r\n]+/gi,
  /\b(?:bearer|basic)\s+[^\s,;]+/gi,
  /\b(?:authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|access[-_]?key|session[-_]?id)\b\s*[:=]\s*[^\s,;]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
];

function redact(value: string, counter: { value: number }): string {
  let result = value;
  for (const pattern of REDACTIONS) {
    result = result.replace(pattern, () => {
      counter.value += 1;
      return "[REDACTED]";
    });
  }
  return result;
}

function sourceFile(file: string): string {
  const clean = file.replaceAll("\\", "/").replace(/[?#].*$/, "");
  return clean.slice(0, 512);
}

function fingerprintFile(file: string): string {
  const clean = sourceFile(file);
  for (const marker of REPOSITORY_MARKERS) {
    const index = clean.lastIndexOf(marker);
    if (index >= 0) return clean.slice(index + 1);
  }
  return clean;
}

function frames(stack: unknown, counter: { value: number }): DiagnosticFrame[] {
  if (typeof stack !== "string") return [];
  const parsed: DiagnosticFrame[] = [];
  for (const line of stack.split(/\r?\n/).slice(1)) {
    const match = line.match(V8_FRAME);
    if (!match) continue;
    const file = sourceFile(match[2]);
    parsed.push({
      ...(match[1]
        ? { function: redact(match[1], counter).slice(0, 256) }
        : {}),
      file: file.slice(0, 512),
      line: Number(match[3]),
      column: Number(match[4]),
    });
    if (parsed.length === 50) break;
  }
  return parsed;
}

function normalizedCause(cause: DiagnosticCause | undefined): unknown {
  if (!cause) return undefined;
  return {
    ...cause,
    frames: cause.frames.map((frame) => ({
      ...frame,
      file: fingerprintFile(frame.file),
    })),
    ...(cause.cause ? { cause: normalizedCause(cause.cause) } : {}),
  };
}

function optionalText(value: unknown, max: number, counter: { value: number }) {
  return typeof value === "string" && value
    ? redact(value, counter).slice(0, max)
    : undefined;
}

function sanitizeCause(
  value: unknown,
  depth: number,
  counter: { value: number },
): DiagnosticCause | undefined {
  if (!value || typeof value !== "object" || depth > 3) return undefined;
  const input = value as Record<string, unknown>;
  const message =
    optionalText(input.message, 2_048, counter) ?? "Error details unavailable";
  const name = optionalText(input.name, 128, counter);
  const code = optionalText(input.code, 128, counter);
  return {
    ...(name ? { name } : {}),
    ...(code ? { code } : {}),
    message,
    frames: frames(input.stack, counter),
    ...(depth < 3 && input.cause
      ? { cause: sanitizeCause(input.cause, depth + 1, counter) }
      : {}),
  };
}

export function sanitizeText(
  value: unknown,
  fallback = "Application error",
): { value: string; redactionCount: number } {
  const counter = { value: 0 };
  const text = typeof value === "string" && value ? value : fallback;
  return {
    value: redact(text, counter).slice(0, 2_048),
    redactionCount: counter.value,
  };
}

export function sanitizeDiagnostic(value: unknown): LogDiagnostic | null {
  if (!value || typeof value !== "object") return null;
  try {
    const counter = { value: 0 };
    const input = value as Record<string, unknown>;
    if (
      typeof input.message !== "string" &&
      typeof input.stack !== "string" &&
      !(input.cause && typeof input.cause === "object")
    )
      return null;
    const message =
      optionalText(input.message, 2_048, counter) ??
      "Error details unavailable";
    const parsedFrames = frames(input.stack, counter);
    const cause = sanitizeCause(input.cause, 1, counter);
    const normalized = JSON.stringify({
      name: optionalText(input.name, 128, { value: 0 }) ?? "Error",
      code: optionalText(input.code, 128, { value: 0 }) ?? "",
      message: message.replaceAll("[REDACTED]", "?"),
      frames: parsedFrames.map((frame) => ({
        ...frame,
        file: fingerprintFile(frame.file),
      })),
      cause: normalizedCause(cause),
    });
    return logDiagnosticSchema.parse({
      message,
      frames: parsedFrames,
      ...(cause ? { cause } : {}),
      fingerprint: createHash("sha256").update(normalized).digest("hex"),
      redactionCount: counter.value,
    });
  } catch {
    return null;
  }
}
