/** DESC-23: editions are ordered by comparing MAJOR and then MINOR, as numbers. */
export const later = (a: string, b: string): boolean => {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  return am !== bm ? am > bm : an > bn;
};

/**
 * DESC-40 — how far behind the edition a Worker declares a verifier holding `held` is.
 *
 * `major` is a Descriptor this verifier cannot claim to read at all, and it judges nothing.
 * `minor` is one it can: the Worker has grown since this tool was built, and what tells the two
 * apart is no longer the edition but what the Worker declares — each Capability, by name and
 * version. `null` is a verifier that holds the declared edition, or a later MINOR of it (DESC-31).
 */
export const behind = (declared: string, held: string): "major" | "minor" | null => {
  if (declared.split(".")[0] !== held.split(".")[0]) return "major";
  return later(declared, held) ? "minor" : null;
};
