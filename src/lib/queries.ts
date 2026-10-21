type QueryError = { message: string } | null;
export function assertQuery<T extends { error: QueryError }>(result: T): T {
  if (result.error) throw new Error("Unable to load business data");
  return result;
}
// Advance by the number returned, including when the API cap is below our page size.
// Large financial summaries use a database aggregate instead.
export async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: QueryError }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ;) {
    const result = assertQuery(await query(start, start + 499));
    if (!result.data?.length) return rows;
    rows.push(...result.data);
    start += result.data.length;
  }
}
