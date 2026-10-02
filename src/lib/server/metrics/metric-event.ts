import {
  MetricEventV1ValidationError,
  parseMetricEventV1,
} from "@contract/metric-event-v1";
import {
  PAGE_VIEW_METRIC,
  VISITOR_KEY_DIMENSION,
} from "@/lib/metric-definitions";

/** The visitor key is transported as a reserved dimension, then stored separately */
export function parseProjectMetricEvent(input: unknown) {
  const event = parseMetricEventV1(input);
  const visitorKey = event.dimensions[VISITOR_KEY_DIMENSION];
  if (
    visitorKey !== undefined &&
    (typeof visitorKey !== "string" || !/^[a-f0-9]{64}$/.test(visitorKey))
  ) {
    throw new MetricEventV1ValidationError([
      {
        path: "dimensions.visitorKey",
        message: "Expected a SHA-256 visitor digest",
      },
    ]);
  }
  if (event.name === PAGE_VIEW_METRIC) {
    const page = event.dimensions.page;
    if (
      !visitorKey ||
      event.value !== 1 ||
      typeof page !== "string" ||
      !/^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)?$/.test(page) ||
      Object.keys(event.dimensions).some(
        (key) => key !== "page" && key !== VISITOR_KEY_DIMENSION,
      )
    ) {
      throw new MetricEventV1ValidationError([
        {
          path: "dimensions",
          message:
            "Page views require a visitor digest, a public page path, and value 1",
        },
      ]);
    }
  }
  return event;
}
