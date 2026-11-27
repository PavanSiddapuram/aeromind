export class AppHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(redactSecrets(message));
    this.name = "AppHttpError";
  }
}

export function redactSecrets(input: string): string {
  let sanitized = input
    .replace(/AIza[0-9A-Za-z_-]{16,}/g, "[REDACTED_API_KEY]")
    .replace(/AQ\.[0-9A-Za-z_-]{16,}/g, "[REDACTED_API_KEY]");
  const configuredKey = process.env.GEMINI_API_KEY?.trim();
  if (configuredKey && configuredKey.length >= 6) {
    sanitized = sanitized.split(configuredKey).join("[REDACTED_API_KEY]");
  }
  return sanitized;
}
