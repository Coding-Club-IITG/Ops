/**
 * Registration point for services that emit LogEventV1
 */

export const LOG_EVENT_PROJECT_REGISTRY = [
  {
    id: "ccw",
    name: "CCW",
    services: [
      { id: "ccw-web", name: "Web" },
      { id: "ccw-worker", name: "Worker" },
    ],
  },
  {
    id: "coursehub",
    name: "CourseHub",
    services: [{ id: "coursehub-backend", name: "Backend" }],
  },
  {
    id: "habit",
    name: "HABit",
    services: [
      { id: "hab-gateway", name: "Gateway" },
      { id: "hab-api-v1", name: "API v1" },
      { id: "hab-api-v2", name: "API v2" },
      { id: "hab-worker-agenda-v1", name: "Agenda worker v1" },
    ],
  },
] as const;

type ProjectDefinition = (typeof LOG_EVENT_PROJECT_REGISTRY)[number];

export type LogEventProject = ProjectDefinition["id"];
export type LogEventService = ProjectDefinition["services"][number]["id"];

export const LOG_EVENT_PROJECTS = LOG_EVENT_PROJECT_REGISTRY.map(
  (project) => project.id,
) as unknown as readonly [LogEventProject, ...LogEventProject[]];

export const LOG_EVENT_SERVICES = LOG_EVENT_PROJECT_REGISTRY.flatMap(
  (project) => project.services.map((service) => service.id),
) as unknown as readonly [LogEventService, ...LogEventService[]];

export const LOG_EVENT_SERVICE_DEFINITIONS = LOG_EVENT_PROJECT_REGISTRY.flatMap(
  (project) =>
    project.services.map((service) => ({
      project: project.id,
      projectName: project.name,
      service: service.id,
      serviceName: service.name,
    })),
);

const SERVICES_BY_PROJECT = new Map<string, ReadonlySet<string>>(
  LOG_EVENT_PROJECT_REGISTRY.map((project) => [
    project.id,
    new Set(project.services.map((service) => service.id)),
  ]),
);

export function isRegisteredProjectService(
  project: string,
  service: string,
): boolean {
  return SERVICES_BY_PROJECT.get(project)?.has(service) ?? false;
}
