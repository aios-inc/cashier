export const toRecurlyIdempotencyKey = (
  idempotencyKey: string | undefined,
  operation: string,
): string | undefined =>
  idempotencyKey ? `${idempotencyKey}-${operation}` : undefined;
