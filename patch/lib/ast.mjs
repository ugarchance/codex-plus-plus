import * as acorn from "acorn";
export function visit(node, fn, ancestors = []) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") {
    fn(node, ancestors);
    ancestors = [...ancestors, node];
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end") continue;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, fn, ancestors);
    } else if (value && typeof value === "object") visit(value, fn, ancestors);
  }
}
export function functionAt(source, constant) {
  const tree = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const found = new Map();
  visit(tree, (n, a) => {
    if (
      (n.type === "TemplateElement" && n.value.raw === constant) ||
      (n.type === "Literal" && n.value === constant)
    ) {
      const f = a.findLast((x) => /Function|ArrowFunction/.test(x.type));
      if (f) found.set(f.start, f);
    }
  });
  if (found.size !== 1)
    throw Error(
      `Expected one enclosing function for ${constant}, found ${found.size}`,
    );
  return [...found.values()][0];
}
