/** Normalize broker/DB date strings to YYYY-MM-DD for grouping and comparisons. */
export function tradeDateKey(iso: string | undefined | null): string {
  if (!iso) return '';
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}
