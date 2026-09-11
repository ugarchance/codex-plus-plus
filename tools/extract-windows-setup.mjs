// Read-only bundle diagnosis using semantic constants rather than minified names.
import { createRequire } from 'node:module';
import path from 'node:path';
import { resolveInstalledAsar } from './installed-paths.mjs';

const parser = createRequire(path.join(process.argv[2], 'package.json'));
const { parse } = parser('acorn');
const { ancestor } = parser('acorn-walk');
const { format } = parser('prettier');
const { extractFile, listPackage } = createRequire(new URL('../patch/package.json', import.meta.url))('@electron/asar');
const archive = resolveInstalledAsar();
const files = listPackage(archive).filter(name => /webview[/\\]assets[/\\]app-initial-[^/\\]+\.js$/.test(name));
if (files.length !== 1) throw new Error(`Expected one app-initial bundle: ${files.length}`);
const source = extractFile(archive, files[0].replace(/^[/\\]/, '')).toString();
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const needles = process.argv.slice(3);
const listOnly = needles.includes('--list');
const functions = new Map();
ancestor(ast, {
  TemplateElement(node, parents) { inspect(node.value.cooked ?? '', parents); },
  Literal(node, parents) { if (typeof node.value === 'string') inspect(node.value, parents); },
  MethodDefinition(node) {
    if (needles.includes(`method:${node.key?.name}`)) functions.set(node.start, { fn: node.value, method: node, text: node.key.name });
  },
});
function inspect(text, parents) {
  if (!needles.some(needle => text.includes(needle))) return;
  if (listOnly) { console.log(text.slice(0, 800)); return; }
  const fn = parents.findLast(node => /FunctionExpression|FunctionDeclaration|ArrowFunctionExpression/.test(node.type));
  if (fn) functions.set(fn.start, { fn, text, method: parents.findLast(node => node.type === 'MethodDefinition' && node.value === fn) });
  const cls = parents.findLast(node => node.type === 'ClassDeclaration' || node.type === 'ClassExpression');
  if (cls) console.log(JSON.stringify({ classMethods: cls.body.body.map(item => item.key?.name ?? item.key?.value) }));
}
for (const { fn, text, method } of functions.values()) {
  console.log(`ANCHOR ${text.slice(0, 120)}`);
  let slice = source.slice(fn.start, fn.end);
  if (fn.type === 'FunctionExpression' && slice.startsWith('(')) slice = `${fn.async ? 'async ' : ''}function${slice}`;
  console.log(await format(method ? `class Extracted extends Object { ${source.slice(method.start, method.end)} }` : `const extracted = ${slice};`, { parser: 'babel' }));
}
