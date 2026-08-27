import { z } from "zod";
import { ensureMongoCollections } from "@/lib/server/metrics/metrics-store";
import { seedDefaultLogViews } from "@/lib/server/log-views";
import { upsertOperatorGrant } from "@/lib/server/operator-grants";
import { getMongoClient, getMongoDatabase } from "@/lib/server/mongo";
import { writeAuditEvent } from "@/lib/server/audit";

async function main(): Promise<void> {
  const email = z
    .email()
    .parse(process.env.OPS_SEED_ADMIN_EMAIL)
    .trim()
    .toLowerCase();
  const actorId = "ops-seed";
  await ensureMongoCollections();
  await upsertOperatorGrant({ email, role: "admin", enabled: true }, actorId);
  const defaultViewCount = await seedDefaultLogViews(actorId);
  await writeAuditEvent({
    operatorId: actorId,
    operatorEmail: email,
    action: "seed.run",
    attributes: { adminGrantUpserted: true, defaultViewCount },
  });
  await (await getMongoDatabase()).collection("seed_activity").insertOne({
    version: 1,
    adminGrantUpserted: true,
    defaultViewCount,
    occurredAt: new Date(),
  });
  console.info(`Ops seed completed (${defaultViewCount} default log views).`);
}

main()
  .catch((error) => {
    console.error(
      "Ops seed failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await getMongoClient().close();
  });
