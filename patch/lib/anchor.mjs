export function replaceOnce(source, anchor, replacement) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) {
    throw new Error(`Çapa tam olarak 1 kez bulunmalıydı, ${count} kez bulundu`);
  }
  const index = source.indexOf(anchor);
  return source.slice(0, index) + replacement + source.slice(index + anchor.length);
}
