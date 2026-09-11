/** Locate an actual quotation, allowing only differences in whitespace. */
export function findEvidenceRange(text: string, evidence?: string) {
  if (!evidence?.trim()) return null;
  const directIndex = text.indexOf(evidence);
  if (directIndex >= 0) return { start: directIndex, end: directIndex + evidence.length };
  const pattern = evidence.trim().split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const match = new RegExp(pattern, "i").exec(text);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
