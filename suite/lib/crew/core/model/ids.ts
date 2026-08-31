/** Short prefixed identifiers. Prefix is for reading a document by eye. */
export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
