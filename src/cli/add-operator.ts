import {
  operatorGrantInputSchema,
  upsertOperatorGrant,
} from "@/lib/server/operator-grants";
import { getMongoClient } from "@/lib/server/mongo";

async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (key?.startsWith("--") && value) args.set(key.slice(2), value);
  }

  const grant = operatorGrantInputSchema.parse({
    email: args.get("email"),
    role: args.get("role") ?? "viewer",
    enabled: true,
  });
  const saved = await upsertOperatorGrant(grant, "cli");
  console.log(`Saved ${saved.email} as ${saved.role}.`);
}

main()
  .catch((error: unknown) => {
    console.error("Unable to add Ops user:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getMongoClient().close();
  });
