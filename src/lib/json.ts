/**
 * The boundary between application values and `jsonb` columns.
 *
 * `Record<string, unknown>` is convenient in application code but is not assignable
 * to a `Json` type, and for a good reason: `unknown` can hold a function, a BigInt or
 * a circular structure, none of which survive a trip to Postgres. Rather than widen
 * the column types and find out at runtime, values pass through here.
 *
 * The round-trip is also the honest check — if a value cannot be stringified, it was
 * never storable, and we would rather record a diagnostic than throw inside a logging
 * call and take down the run being logged.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type JsonObject = { [key: string]: Json | undefined };

/**
 * Convert an arbitrary value to something a `jsonb` column accepts.
 *
 * Non-serialisable input yields a diagnostic object rather than an exception,
 * because the callers are error paths and log writes: the last thing a failing run
 * needs is for its own error report to throw.
 */
export function toJson(value: unknown): Json {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as Json;
  } catch (cause) {
    return {
      _unserializable: true,
      reason: cause instanceof Error ? cause.message : String(cause),
      typeof: typeof value,
    };
  }
}

/** As `toJson`, but guarantees an object so a `jsonb` default of `{}` is preserved. */
export function toJsonObject(value: unknown): JsonObject {
  const json = toJson(value);
  if (json !== null && typeof json === 'object' && !Array.isArray(json)) return json;
  return json === null ? {} : { value: json };
}
