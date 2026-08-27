import { ServicesView } from "@/features/services-view";

export default async function ServicePage({
  params,
}: {
  params: Promise<{ service: string }>;
}) {
  return <ServicesView service={(await params).service} />;
}
