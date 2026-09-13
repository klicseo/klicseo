import "server-only";

/** Read past PostgREST's response cap; callers provide a deterministic order. */
export async function readAllRows<T>(query: {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}): Promise<T[]> {
  const rows: T[] = [];
  const batchSize = 500;
  for (let offset = 0; ; offset += batchSize) {
    const { data, error } = await query.range(offset, offset + batchSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < batchSize) return rows;
  }
}
