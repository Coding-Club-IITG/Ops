import type { Collection } from "mongodb";
import { getMongoDatabase } from "@/lib/server/mongo";
import type { MetricSnapshot } from "@/lib/server/metrics/metrics-types";
import type { MetricsRange } from "@/lib/server/logs/log-query";

const RANGE_MS: Record<MetricsRange, number> = {
  "1h": 60 * 60 * 1_000,
  "6h": 6 * 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

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

  await database
    .collection("operator_snapshots")
    .createIndex({ operatorId: 1, capturedAt: -1 });
  await database.collection("audit_events").createIndex({ occurredAt: -1 });
}

export async function addMetricSnapshot(
  snapshot: MetricSnapshot,
): Promise<void> {
  await (await collection()).insertOne(snapshot);
}

export async function getMetricSnapshots(
  range: MetricsRange,
): Promise<MetricSnapshot[]> {
  const since = new Date(Date.now() - RANGE_MS[range]);
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
