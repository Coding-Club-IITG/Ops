import type { Collection } from "mongodb";
import { getMongoDatabase } from "@/lib/server/mongo";
import type { MetricSnapshot } from "@/lib/server/metrics/metrics-types";
import type { MetricsRange } from "@/lib/server/logs/log-query";
import { OPS_RANGE_MILLISECONDS } from "@/lib/ops-constants";

async function collection(): Promise<Collection<MetricSnapshot>> {
  return (await getMongoDatabase()).collection<MetricSnapshot>(
    "system_metrics",
  );
}

export async function ensureMongoCollections(): Promise<void> {
  const database = await getMongoDatabase();
  const names = new Set(
    (await database.listCollections({}, { nameOnly: true }).toArray()).map(
      (item) => item.name,
    ),
  );

  if (!names.has("system_metrics")) {
    await database.createCollection("system_metrics", {
      timeseries: {
        timeField: "measuredAt",
        metaField: "source",
        granularity: "seconds",
      },
      expireAfterSeconds: 30 * 24 * 60 * 60,
    });
  }
  if (!names.has("operator_snapshots"))
    await database.createCollection("operator_snapshots");
  if (!names.has("audit_events"))
    await database.createCollection("audit_events");
  if (!names.has("operator_grants"))
    await database.createCollection("operator_grants");
  if (!names.has("log_views")) await database.createCollection("log_views");
  if (!names.has("seed_activity"))
    await database.createCollection("seed_activity");

  await database
    .collection("operator_snapshots")
    .createIndex({ operatorId: 1, capturedAt: -1 });
  await database
    .collection("audit_events")
    .createIndex(
      { occurredAt: -1, action: 1 },
      { name: "audit_events_date_action" },
    );
  await database
    .collection("audit_events")
    .createIndex(
      { operatorId: 1, occurredAt: -1 },
      { name: "audit_events_actor_date" },
    );
  await database
    .collection("audit_events")
    .createIndex(
      { operatorEmail: 1, occurredAt: -1 },
      { name: "audit_events_email_date" },
    );
  await database
    .collection("operator_grants")
    .createIndex(
      { email: 1 },
      { unique: true, name: "operator_grants_email_unique" },
    );
  await database
    .collection("log_views")
    .createIndex({ id: 1 }, { unique: true, name: "log_views_id_unique" });
  await database
    .collection("log_views")
    .createIndex(
      { normalizedName: 1 },
      { unique: true, name: "log_views_name_unique" },
    );
  await database.collection("seed_activity").createIndex({ occurredAt: -1 });
}

export async function addMetricSnapshot(
  snapshot: MetricSnapshot,
): Promise<void> {
  await (await collection()).insertOne(snapshot);
}

export async function getMetricSnapshots(
  range: MetricsRange,
): Promise<MetricSnapshot[]> {
  const since = new Date(Date.now() - OPS_RANGE_MILLISECONDS[range]);
  const rows = await (
    await collection()
  )
    .find({ measuredAt: { $gte: since } }, { projection: { _id: 0 } })
    .sort({ measuredAt: 1 })
    .toArray();

  if (rows.length <= 180) return rows;
  const stride = Math.ceil(rows.length / 180);
  return rows.filter(
    (_, index) => index % stride === 0 || index === rows.length - 1,
  );
}

export async function getLatestMetricSnapshot(): Promise<MetricSnapshot | null> {
  return (await collection()).findOne(
    {},
    { sort: { measuredAt: -1 }, projection: { _id: 0 } },
  );
}

export async function getObservedPm2Names(): Promise<Set<string>> {
  const names = await (
    await collection()
  ).distinct("pm2.name", {
    measuredAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000) },
  });
  return new Set(
    names.filter((name): name is string => typeof name === "string"),
  );
}
