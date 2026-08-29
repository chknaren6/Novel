// Several Prisma fields hold JSON as a plain SQLite TEXT column (see prisma/schema.prisma
// comments: SQLite's Prisma connector doesn't support the native Json type). These two
// helpers are the single place that convention is enforced, so a forgotten stringify/parse
// fails loudly here instead of silently corrupting a column.
export function toJsonColumn(value: unknown): string {
  return JSON.stringify(value);
}

export function fromJsonColumn<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new Error(`json-column: stored value is not valid JSON: ${raw}`, { cause });
  }
}
