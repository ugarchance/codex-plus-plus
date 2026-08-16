export function matchOnce(source, pattern, label) {
  const matches = [...source.matchAll(new RegExp(pattern, "g"))];
  if (matches.length !== 1) {
    throw new Error(`pattern ${label} had to match exactly once, matched ${matches.length} times`);
  }
  return matches[0];
}

export function replaceOnce(source, anchor, replacement) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) {
    throw new Error(`anchor had to occur exactly once, occurred ${count} times`);
  }
  const index = source.indexOf(anchor);
  return source.slice(0, index) + replacement + source.slice(index + anchor.length);
}
