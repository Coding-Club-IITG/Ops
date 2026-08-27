import { ZodError } from "zod";
import { clampExportWindow, logsToCsv } from "@/lib/server/logs/csv";
import { logsQuerySchema } from "@/lib/server/logs/log-query";
import { listLogs } from "@/lib/server/logs/log-repository";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";
import { writeAuditEvent } from "@/lib/server/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const operator = await requireOperator(request);
  if (!operator) return unauthorizedResponse();
  try {
    const raw = Object.fromEntries(new URL(request.url).searchParams.entries());
    const window = clampExportWindow(raw.from, raw.to);
    const query = logsQuerySchema.parse({
      ...raw,
      ...window,
      limit: 100,
      offset: 0,
    });
    const pages = [];
    for (let offset = 0; offset < 10_000; offset += 100) {
      const result = await listLogs({ ...query, offset });
      pages.push(...result.data);
      if (result.data.length < 100) break;
    }
    const filename = `ops-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    await writeAuditEvent({
      operatorId: operator.id,
      operatorEmail: operator.email,
      action: "logs.export",
      attributes: { rowCount: pages.length, windowHours: 24 },
    });
    return new Response(logsToCsv(pages), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "x-ops-export-limit": "10000",
        "x-ops-export-window-hours": "24",
      },
    });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json({ error: "Invalid export query" }, { status: 400 });
    console.error("Failed to export logs", error);
    return Response.json({ error: "Failed to export logs" }, { status: 500 });
  }
}
