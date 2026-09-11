import * as acorn from 'acorn';
import { functionAt, visit } from '../lib/ast.mjs';
const MARKER = 'codexpp-web-engine-catalog-v2';
export default {
  id: '119-web-engine-catalog',
  description: 'Pass a native-preserving Web catalog at local Codex++ engine startup, never through shared config',
  glob: '.vite/build/src-*.js', select: 'CODEX_APP_SERVER_OPENAI_BASE_URL', marker: MARKER,
  apply(source) {
    const factory = functionAt(source, '--analytics-default-enabled');
    if (factory.type !== 'FunctionDeclaration' || factory.params.length !== 0) throw new Error('Engine argument factory changed');
    const tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const edits = [], owners = new Map();
    visit(tree, (node, ancestors) => {
      if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || node.callee.name !== factory.id.name) return;
      const owner = ancestors.findLast(x => x.type === 'FunctionDeclaration');
      if (node.arguments.length || owner?.params[0]?.type !== 'Identifier'
        || !source.slice(owner.start, owner.end).includes('.hostConfig.codex_cli_command')) throw new Error('Engine argument call ownership changed');
      owners.set(owner.start, (owners.get(owner.start) ?? 0) + 1);
      edits.push({ start: node.start, end: node.end, text: `${factory.id.name}(${owner.params[0].name}.hostConfig)` });
    });
    if (edits.length !== 4 || owners.size !== 2 || [...owners.values()].some(n => n !== 2)) throw new Error('Expected four engine argument call sites in two local resolvers');
    const body = source.slice(factory.body.start + 1, factory.body.end - 1);
    edits.push({ start: factory.start, end: factory.end, text:
      `function ${factory.id.name}(__cxpHost){/* ${MARKER} */const __cxpOriginal=()=>{${body}};return require(require('node:path').join(process.resourcesPath,'hub','web-model-catalog.cjs')).engineArgs(__cxpOriginal(),__cxpHost)}` });
    for (const edit of edits.sort((a,b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    return source;
  },
};
