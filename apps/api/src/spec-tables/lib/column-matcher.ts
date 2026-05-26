/**
 * Column-matching logic for linking spec-table rows to taxonomy nodes.
 *
 * Matching strategy (case-insensitive, trimmed):
 * 1. Exact match on `code` field of the taxonomy node.
 * 2. Exact match on `name` field.
 * 3. Starts-with match on `name` (handles "OA1 - Leer y comprender" vs "OA1").
 */

export interface ColumnMapping {
  /** Column name that contains the item position / question number. */
  position: string;
  /** Column name for skill (habilidad). */
  skill?: string;
  /** Column name for learning objective (OA). */
  oa?: string;
  /** Column name for content area. */
  content?: string;
  /** Column name for difficulty level. */
  difficulty?: string;
  /** Column name for the correct answer key. */
  correctAnswer?: string;
}

export interface LinkResult {
  linked: number;
  warnings: string[];
  errors: string[];
}

export interface TaxonomyNodeRef {
  id: string;
  type: string;
  code: string | null;
  name: string;
}

/**
 * Finds a taxonomy node that matches the given cell value.
 *
 * Returns `undefined` when no match is found.
 */
export function findMatchingNode(
  cellValue: string,
  nodes: TaxonomyNodeRef[],
  expectedType?: string,
): TaxonomyNodeRef | undefined {
  const needle = cellValue.trim().toLowerCase();
  if (!needle) return undefined;

  const candidates = expectedType
    ? nodes.filter((n) => n.type === expectedType)
    : nodes;

  // 1. Exact code match
  const byCode = candidates.find(
    (n) => n.code !== null && n.code.toLowerCase() === needle,
  );
  if (byCode) return byCode;

  // 2. Exact name match
  const byName = candidates.find(
    (n) => n.name.trim().toLowerCase() === needle,
  );
  if (byName) return byName;

  // 3. Starts-with on code (handles "OA1" matching code "OA1")
  const byCodePrefix = candidates.find(
    (n) => n.code !== null && needle.startsWith(n.code.toLowerCase()),
  );
  if (byCodePrefix) return byCodePrefix;

  // 4. Starts-with on name (handles partial matches)
  const byNamePrefix = candidates.find(
    (n) => n.name.trim().toLowerCase().startsWith(needle),
  );
  if (byNamePrefix) return byNamePrefix;

  // 5. Reverse starts-with: the node name starts with the needle
  const byNameContains = candidates.find(
    (n) => needle.startsWith(n.name.trim().toLowerCase()),
  );
  if (byNameContains) return byNameContains;

  return undefined;
}
