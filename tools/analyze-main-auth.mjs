#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [sourcePath, parserModules, outputDir, ...needles] = process.argv.slice(2);
if (!sourcePath || !parserModules || !outputDir || needles.length === 0) {
  throw new Error("usage: analyze-main-auth.mjs <source> <parser-node-modules> <output-dir> <needle...>");
}

const acorn = await import(pathToFileURL(path.join(parserModules, "acorn", "dist", "acorn.mjs")));
const walk = await import(pathToFileURL(path.join(parserModules, "acorn-walk", "dist", "walk.mjs")));
const prettier = await import(pathToFileURL(path.join(parserModules, "prettier", "index.mjs")));

const source = fs.readFileSync(sourcePath, "utf8");
const ast = acorn.parse(source, {
  ecmaVersion: "latest",
  sourceType: "module",
  allowHashBang: true,
});

const isFunction = (node) =>
  node &&
  ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type);

fs.mkdirSync(outputDir, { recursive: true });

for (const needle of needles) {
  const hits = [];
  walk.ancestor(ast, {
    Literal(node, _state, ancestors) {
      if (typeof node.value === "string" && node.value.includes(needle)) hits.push({ node, ancestors: [...ancestors] });
    },
    TemplateElement(node, _state, ancestors) {
      if (node.value.raw.includes(needle)) hits.push({ node, ancestors: [...ancestors] });
    },
  });

  console.log(`[${needle}] hits=${hits.length}`);
  for (let index = 0; index < hits.length; index += 1) {
    const { ancestors } = hits[index];
    const fn = [...ancestors].reverse().find(isFunction);
    console.log(`  ancestors=${ancestors.map((node) => node.type).join(">")} `);
    if (!fn) {
      console.log(`  hit=${index + 1} enclosingFunction=none`);
      continue;
    }
    const method = [...ancestors].reverse().find((node) => node.type === "MethodDefinition");
    let snippet;
    if (method && method.value === fn) {
      snippet = `class Extracted extends Object { ${source.slice(method.start, method.end)} }`;
    } else {
      snippet = source.slice(fn.start, fn.end);
    }
    if (!method && (fn.type === "FunctionExpression" || fn.type === "ArrowFunctionExpression")) {
      snippet = `const extracted = ${snippet};`;
    }
    const safeNeedle = needle.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    const outPath = path.join(outputDir, `${safeNeedle}-${index + 1}.js`);
    try {
      const formatted = await prettier.format(snippet, { parser: "babel" });
      fs.writeFileSync(outPath, formatted);
      console.log(`  hit=${index + 1} function=${fn.type} start=${fn.start} end=${fn.end} out=${outPath}`);
    } catch (error) {
      console.log(
        `  hit=${index + 1} function=${fn.type} start=${fn.start} end=${fn.end} formatError=${JSON.stringify(error.message)}`,
      );
    }
  }
}
