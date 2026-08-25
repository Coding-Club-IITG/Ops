import { getMongoDatabase } from "@/lib/server/mongo";

export async function writeAuditEvent(input: {
  operatorId: string;
  action: "logs.export" | "operators.upsert";
  attributes: Record<string, string | number | boolean>;
}): Promise<void> {
  const database = await getMongoDatabase();
  await database.collection("audit_events").insertOne({
    ...input,
    occurredAt: new Date(),
  });
}
