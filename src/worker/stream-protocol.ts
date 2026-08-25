export type StreamMessage = { id: string; fields: Record<string, string> };

export function parseStreamReply(reply: unknown): StreamMessage[] {
  const streams = Array.isArray(reply)
    ? reply
    : typeof reply === "object" && reply !== null
      ? Object.entries(reply)
      : [];
  const messages: StreamMessage[] = [];

  for (const stream of streams) {
    if (!Array.isArray(stream) || !Array.isArray(stream[1])) continue;
    for (const entry of stream[1]) {
      if (
        !Array.isArray(entry) ||
        typeof entry[0] !== "string" ||
        !Array.isArray(entry[1])
      )
        continue;
      const fields: Record<string, string> = {};
      for (let index = 0; index < entry[1].length; index += 2) {
        const key = entry[1][index];
        const value = entry[1][index + 1];
        if (typeof key === "string" && typeof value === "string")
          fields[key] = value;
      }
      messages.push({ id: entry[0], fields });
    }
  }
  return messages;
}

export function getDeliveryCount(reply: unknown): number {
  if (!Array.isArray(reply) || !Array.isArray(reply[0])) return 1;
  const value = reply[0][3];
  return typeof value === "number" ? value : Number(value) || 1;
}

export function extractEventPayload(message: StreamMessage): string {
  const payload = message.fields.event;
  if (!payload)
    throw new SyntaxError("Redis stream entry must contain an event field");
  return payload;
}
