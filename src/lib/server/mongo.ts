import { MongoClient, type Db } from "mongodb";
import { getRuntimeConfig } from "@/lib/server/env";

const globalForMongo = globalThis as unknown as {
  opsMongoClient?: MongoClient;
  opsMongoConnection?: Promise<MongoClient>;
};

export function getMongoClient(): MongoClient {
  if (!globalForMongo.opsMongoClient) {
    globalForMongo.opsMongoClient = new MongoClient(
      getRuntimeConfig().MONGODB_URI,
      {
        appName: "ops",
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 3_000,
      },
    );
  }
  return globalForMongo.opsMongoClient;
}

export async function getMongoDatabase(): Promise<Db> {
  const client = getMongoClient();
  globalForMongo.opsMongoConnection ??= client.connect();
  await globalForMongo.opsMongoConnection;
  return client.db();
}

export function getMongoDatabaseHandle(): Db {
  return getMongoClient().db();
}

export async function checkMongo(): Promise<void> {
  const database = await getMongoDatabase();
  await database.command({ ping: 1 });
}
