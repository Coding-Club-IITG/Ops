import { ObjectId } from "mongodb";
import { z } from "zod";
import { getMongoDatabase } from "@/lib/server/mongo";
import { AUDIT_ACTIONS, type AuditAction } from "@/types/audit";
import { DEFAULT_PAGE_SIZE } from "@/lib/ops-constants";
const optionalDate = z.string().datetime({ offset: true }).optional();
export const auditQuerySchema = z
  .object({
    from: optionalDate,
    to: optionalDate,
    action: z.enum(AUDIT_ACTIONS).optional(),
    actor: z.string().trim().min(1).max(320).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to))
      context.addIssue({
        code: "custom",
        path: ["from"],
        message: "from must not be after to",
      });
  });

export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type StoredAuditEvent = {
  _id?: ObjectId;
  operatorId: string;
  operatorEmail?: string;
  action: AuditAction;
  attributes: Record<string, string | number | boolean>;
  occurredAt: Date;
};

export function parseAuditQuery(url: string): AuditQuery {
  return auditQuerySchema.parse(
    Object.fromEntries(new URL(url).searchParams.entries()),
  );
}

export async function writeAuditEvent(input: {
  operatorId: string;
  operatorEmail?: string;
  action: AuditAction;
  attributes: Record<string, string | number | boolean>;
}): Promise<void> {
  const database = await getMongoDatabase();
  await database.collection<StoredAuditEvent>("audit_events").insertOne({
    ...input,
    occurredAt: new Date(),
  });
}

export async function listAuditEvents(query: AuditQuery) {
  const filter: Record<string, unknown> = {};
  if (query.from || query.to)
    filter.occurredAt = {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      ...(query.to ? { $lte: new Date(query.to) } : {}),
    };
  if (query.action) filter.action = query.action;
  if (query.actor)
    filter.$or = [
      { operatorId: query.actor },
      { operatorEmail: query.actor.toLowerCase() },
    ];

  const collection = (await getMongoDatabase()).collection<StoredAuditEvent>(
    "audit_events",
  );
  const [rows, total] = await Promise.all([
    collection
      .find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .skip(query.offset)
      .limit(query.limit)
      .toArray(),
    collection.countDocuments(filter),
  ]);
  return {
    data: rows.map(({ _id, occurredAt, ...event }) => ({
      ...event,
      id: _id?.toHexString() ?? "",
      occurredAt: occurredAt.toISOString(),
    })),
    total,
  };
}
