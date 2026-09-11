const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/n't\b/g, " not")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
const negatives = new Set(["not", "never", "no", "cannot", "without"]);
const auxiliary = new Set([
  "is",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "a",
  "an",
  "the",
]);
export function contradictionReason(a: string, b: string): string | null {
  const aw = words(a),
    bw = words(b);
  const core = (w: string[]) =>
    w.filter((t) => !negatives.has(t) && !auxiliary.has(t)).join(" ");
  if (
    aw.some((t) => negatives.has(t)) !== bw.some((t) => negatives.has(t)) &&
    core(aw) === core(bw)
  )
    return "Same assertion has opposing negation; review required.";
  // Deliberately narrow functional slots. Other contradictions remain provider-proposed, never silently resolved.
  const slot = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[.!]$/, "")
      .match(
        /^(.+?\b(?:launches in|launches on|launch date is|deadline is|due date is))\s+(.+)$/,
      );
  const x = slot(a),
    y = slot(b);
  if (x && y && x[1] === y[1] && x[2] !== y[2])
    return "The same dated fact has different values; review required.";
  return null;
}
/** A model's duplicate label cannot erase changed amounts, dates, or polarity. */
export function safeDuplicate(a: string, b: string) {
  if (contradictionReason(a, b)) return false;
  const markers = (s: string) =>
    words(s)
      .filter(
        (t) =>
          negatives.has(t) ||
          /^\d/.test(t) ||
          /^(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(
            t,
          ),
      )
      .join("|");
  return markers(a) === markers(b);
}
