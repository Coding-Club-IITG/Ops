export function GET(): Response {
  return Response.json({
    status: "live",
    service: "ops-web",
    timestamp: new Date().toISOString(),
  });
}
