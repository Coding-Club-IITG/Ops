import { forbiddenResponse, requireAdmin } from "@/lib/server/authorization";
import { getSecurityEvents } from "@/lib/server/security/security-repository";
import type { SecurityEventType } from "@/types/security";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireAdmin(request))) return forbiddenResponse();

  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const eventType =
      (searchParams.get("eventType") as SecurityEventType) || undefined;
    const account = searchParams.get("account") || undefined;
    const sourceIp = searchParams.get("sourceIp") || undefined;
    const result =
      (searchParams.get("result") as "success" | "failure") || undefined;
    const search = searchParams.get("search") || undefined;
    const limit = searchParams.get("limit")
      ? Number(searchParams.get("limit"))
      : 50;
    const offset = searchParams.get("offset")
      ? Number(searchParams.get("offset"))
      : 0;

    const data = await getSecurityEvents({
      from,
      to,
      eventType,
      account,
      sourceIp,
      result,
      search,
      limit,
      offset,
    });

    return Response.json({
      ...data,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to query security events:", error);
    return Response.json(
      { error: "Failed to query security events" },
      { status: 500 },
    );
  }
}
