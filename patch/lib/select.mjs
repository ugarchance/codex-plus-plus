// Alternative semantic selectors let a component move between release chunks.
// File cardinality is still checked by the caller before applying any patch.
export function matchesSelect(source, select) {
  if (!select) return true;
  return (Array.isArray(select) ? select : [select]).some(value => source.includes(value));
}
