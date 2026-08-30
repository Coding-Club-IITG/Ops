import { forbiddenResponse, requireAdmin } from "@/lib/server/authorization";
import { getSecurityStats } from "@/lib/server/security/security-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireAdmin(request))) return forbiddenResponse();

  try {
    const stats = await getSecurityStats();
    return Response.json({
      ...stats,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to query security stats:", error);
    return Response.json(
      { error: "Failed to query security statistics" },
      { status: 500 },
    );
  }
}
