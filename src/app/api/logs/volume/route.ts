import { getLogVolume } from "@/lib/server/logs/log-repository";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireOperator(request))) return unauthorizedResponse();
  try {
    const hours = Math.min(
      24 * 30,
      Math.max(1, Number(new URL(request.url).searchParams.get("hours") ?? 24)),
    );
    return Response.json({
      data: await getLogVolume(hours),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to fetch log volume", error);
    return Response.json(
      { error: "Failed to fetch log volume" },
      { status: 500 },
    );
  }
}
