/** Outgoing-body guard: parse with the strict shared schema; contract drift is a 500, never a partial body. */
import type { z } from 'zod';

import { HttpError } from './errors.js';

export function strictBody<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(500, 'internal_error');
  return r.data;
}
