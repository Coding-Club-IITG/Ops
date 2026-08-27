import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { z } from "zod";
import { OPS_RANGES } from "@/lib/ops-constants";
import {
  LOG_EVENT_ATTRIBUTE_KEYS,
  LOG_EVENT_KINDS,
  LOG_EVENT_LEVELS,
  LOG_EVENT_PROJECTS,
  LOG_EVENT_SERVICES,
} from "@contracts/log-event-v1/log-event-v1";
import { getMongoDatabase } from "@/lib/server/mongo";

export const logRelativeTimeSchema = z.enum(OPS_RANGES);
export type LogRelativeTime = z.infer<typeof logRelativeTimeSchema>;

export const BASE_LOG_COLUMNS = [
  "timestamp",
  "projectService",
  "kind",
  "level",
  "message",
  "method",
  "route",
  "statusCode",
  "durationMs",
  "correlationId",
  "error",
] as const;
export const LOG_VIEW_COLUMNS = [
  ...BASE_LOG_COLUMNS,
  ...LOG_EVENT_ATTRIBUTE_KEYS.map((key) => `attribute:${key}` as const),
] as const;
export type LogViewColumn = (typeof LOG_VIEW_COLUMNS)[number];

const savedFiltersSchema = z
  .object({
    eventId: z.string().trim().min(1).max(128).optional(),
    project: z.enum(LOG_EVENT_PROJECTS).optional(),
    service: z.enum(LOG_EVENT_SERVICES).optional(),
    kind: z.enum(LOG_EVENT_KINDS).optional(),
    level: z.enum(LOG_EVENT_LEVELS).optional(),
    correlationId: z.string().trim().min(1).max(128).optional(),
    method: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .regex(/^[A-Z]+$/)
      .optional(),
    route: z.string().trim().min(1).max(512).optional(),
    statusCode: z.coerce.number().int().min(100).max(599).optional(),
    statusClass: z.enum(["1xx", "2xx", "3xx", "4xx", "5xx"]).optional(),
    durationMin: z.coerce.number().nonnegative().optional(),
    durationMax: z.coerce.number().nonnegative().optional(),
    q: z.string().trim().min(1).max(256).optional(),
  })
  .strict()
  .refine(
    (filters) =>
      filters.durationMin === undefined ||
      filters.durationMax === undefined ||
      filters.durationMin <= filters.durationMax,
    { message: "durationMin must be less than or equal to durationMax" },
  );

const visibleColumnsSchema = z
  .array(z.enum(LOG_VIEW_COLUMNS))
  .min(1)
  .max(LOG_VIEW_COLUMNS.length)
  .refine((columns) => new Set(columns).size === columns.length, {
    message: "Columns must be unique",
  });

export const logViewInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240).optional(),
    relativeTime: logRelativeTimeSchema,
    filters: savedFiltersSchema.default({}),
    sort: z
      .object({
        field: z.enum(["timestamp", "durationMs"]),
        order: z.enum(["asc", "desc"]),
      })
      .strict(),
    visibleColumns: visibleColumnsSchema,
  })
  .strict();

export const logViewPatchSchema = logViewInputSchema.partial().strict();
export type LogViewInput = z.infer<typeof logViewInputSchema>;
export type LogViewPatch = z.infer<typeof logViewPatchSchema>;

type StoredLogView = LogViewInput & {
  id: string;
  normalizedName: string;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type LogViewDto = Omit<
  StoredLogView,
  "normalizedName" | "createdAt" | "updatedAt"
> & {
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_LOG_VIEWS: ReadonlyArray<{
  id: string;
  view: LogViewInput;
}> = [
  {
    id: "default-production-errors",
    view: {
      name: "Production errors",
      description: "Errors and fatal events across production services.",
      relativeTime: "24h",
      filters: { level: "error" },
      sort: { field: "timestamp", order: "desc" },
      visibleColumns: [
        "timestamp",
        "projectService",
        "level",
        "message",
        "correlationId",
        "error",
      ],
    },
  },
  {
    id: "default-http-5xx",
    view: {
      name: "HTTP 5xx",
      description: "Server-error responses from registered HTTP services.",
      relativeTime: "24h",
      filters: { kind: "http", statusClass: "5xx" },
      sort: { field: "timestamp", order: "desc" },
      visibleColumns: [
        "timestamp",
        "projectService",
        "method",
        "route",
        "statusCode",
        "durationMs",
        "correlationId",
      ],
    },
  },
  {
    id: "default-slow-http",
    view: {
      name: "Slow HTTP ≥1s",
      description: "HTTP events taking at least one second.",
      relativeTime: "24h",
      filters: { kind: "http", durationMin: 1_000 },
      sort: { field: "durationMs", order: "desc" },
      visibleColumns: [
        "timestamp",
        "projectService",
        "method",
        "route",
        "statusCode",
        "durationMs",
      ],
    },
  },
];

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

async function collection() {
  const database = await getMongoDatabase();
  const views = database.collection<StoredLogView>("log_views");
  await Promise.all([
    views.createIndex({ id: 1 }, { unique: true, name: "log_views_id_unique" }),
    views.createIndex(
      { normalizedName: 1 },
      { unique: true, name: "log_views_name_unique" },
    ),
  ]);
  return views;
}

function toDto(view: StoredLogView): LogViewDto {
  const { normalizedName: _normalizedName, ...rest } = view;
  return {
    ...rest,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

export function isDuplicateLogViewError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

export async function listLogViews(): Promise<LogViewDto[]> {
  const views = await (
    await collection()
  )
    .find({}, { projection: { _id: 0, normalizedName: 0 } })
    .sort({ name: 1 })
    .toArray();
  return views.map((view) => toDto(view as StoredLogView));
}

export async function createLogView(
  input: LogViewInput,
  actorId: string,
): Promise<LogViewDto> {
  const view = logViewInputSchema.parse(input);
  const now = new Date();
  const stored: StoredLogView = {
    ...view,
    id: randomUUID(),
    normalizedName: normalizeName(view.name),
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: now,
    updatedAt: now,
  };
  await (await collection()).insertOne(stored);
  return toDto(stored);
}

export async function updateLogView(
  id: string,
  patch: LogViewPatch,
  actorId: string,
): Promise<LogViewDto | null> {
  const updates = logViewPatchSchema.parse(patch);
  const set: Record<string, unknown> = {
    ...updates,
    updatedAt: new Date(),
    updatedBy: actorId,
  };
  if (updates.name) set.normalizedName = normalizeName(updates.name);
  const result = await (
    await collection()
  ).findOneAndUpdate(
    { id },
    { $set: set },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return result ? toDto(result) : null;
}

export async function deleteLogView(id: string): Promise<boolean> {
  return (await (await collection()).deleteOne({ id })).deletedCount === 1;
}

export async function seedDefaultLogViews(actorId: string): Promise<number> {
  const views = await collection();
  const now = new Date();
  for (const { id, view } of DEFAULT_LOG_VIEWS) {
    await views.updateOne(
      { id },
      {
        $set: {
          ...view,
          normalizedName: normalizeName(view.name),
          updatedAt: now,
          updatedBy: actorId,
        },
        $setOnInsert: { id, createdAt: now, createdBy: actorId },
      },
      { upsert: true },
    );
  }
  return DEFAULT_LOG_VIEWS.length;
}
