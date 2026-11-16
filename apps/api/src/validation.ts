import { z } from "zod";

export class ValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "invalid_request";
}

// Parses untrusted input or throws a 400 that names each bad field.
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(z.prettifyError(result.error));
  return result.data;
}
