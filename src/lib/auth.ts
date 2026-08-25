import { betterAuth } from "better-auth/minimal";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { getMongoClient, getMongoDatabaseHandle } from "@/lib/server/mongo";
import { getRuntimeConfig } from "@/lib/server/env";

const config = getRuntimeConfig();

export const auth = betterAuth({
  appName: "Ops",
  baseURL: config.BASE_URL,
  secret: config.AUTH_SECRET,
  trustedOrigins: config.TRUSTED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  database: mongodbAdapter(getMongoDatabaseHandle(), {
    client: getMongoClient(),
  }),
  advanced: { database: { joins: true }, trustedProxyHeaders: true },
  socialProviders: {
    microsoft: {
      clientId: config.AZURE_CLIENT_ID,
      clientSecret: config.AZURE_CLIENT_SECRET,
      tenantId: config.AZURE_TENANT_ID,
      scope: ["User.Read", "offline_access"],
      prompt: "select_account",
    },
  },
  account: {
    accountLinking: { enabled: true, trustedProviders: ["microsoft"] },
  },
});
