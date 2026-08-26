import { z } from "zod";
import { logDiagnosticSchema } from "@/lib/server/logs/log-diagnostics";

export const INGESTION_ENVELOPE_VERSION = 1 as const;

export const ingestionEnvelopeSchema = z
  .object({
    envelopeVersion: z.literal(INGESTION_ENVELOPE_VERSION),
    event: z.unknown(),
    diagnostic: logDiagnosticSchema.optional(),
  })
  .strict();

export type IngestionEnvelope = z.infer<typeof ingestionEnvelopeSchema>;
