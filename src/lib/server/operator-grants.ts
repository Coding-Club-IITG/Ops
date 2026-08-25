import { z } from "zod";
import { getMongoDatabase } from "@/lib/server/mongo";

export const operatorRoleSchema = z.enum(["viewer", "admin"]);

export const operatorGrantInputSchema = z
  .object({
    email: z.email().transform((email) => email.trim().toLowerCase()),
    role: operatorRoleSchema,
    enabled: z.boolean().default(true),
  })
  .strict();

export type OperatorRole = z.infer<typeof operatorRoleSchema>;
export type OperatorGrantInput = z.infer<typeof operatorGrantInputSchema>;

export type OperatorGrant = OperatorGrantInput & {
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
};

export type OperatorGrantDto = Omit<
  OperatorGrant,
  "createdAt" | "updatedAt" | "createdBy" | "updatedBy"
> & {
  createdAt: string;
  updatedAt: string;
};

let indexesReady: Promise<unknown> | undefined;

async function getOperatorCollection() {
  const database = await getMongoDatabase();
  const collection = database.collection<OperatorGrant>("operator_grants");
  indexesReady ??= collection.createIndex(
    { email: 1 },
    { unique: true, name: "operator_grants_email_unique" },
  );
  await indexesReady;
  return collection;
}

export async function findEnabledOperatorGrant(
  email: string,
): Promise<OperatorGrant | null> {
  const collection = await getOperatorCollection();
  return collection.findOne({
    email: email.trim().toLowerCase(),
    enabled: true,
  });
}

export async function listOperatorGrants(): Promise<OperatorGrantDto[]> {
  const collection = await getOperatorCollection();
  const grants = await collection
    .find({}, { projection: { _id: 0, createdBy: 0, updatedBy: 0 } })
    .sort({ email: 1 })
    .toArray();

  return grants.map(toDto);
}

export async function upsertOperatorGrant(
  input: OperatorGrantInput,
  actorId: string,
): Promise<OperatorGrantDto> {
  const grant = operatorGrantInputSchema.parse(input);
  const collection = await getOperatorCollection();
  const now = new Date();

  await collection.updateOne(
    { email: grant.email },
    {
      $set: { ...grant, updatedAt: now, updatedBy: actorId },
      $setOnInsert: { createdAt: now, createdBy: actorId },
    },
    { upsert: true },
  );

  const stored = await collection.findOne({ email: grant.email });
  if (!stored) throw new Error("Operator grant was not persisted");
  return toDto(stored);
}

function toDto(grant: OperatorGrant): OperatorGrantDto {
  return {
    email: grant.email,
    role: grant.role,
    enabled: grant.enabled,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
  };
}
