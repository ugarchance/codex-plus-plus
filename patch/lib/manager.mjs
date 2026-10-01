import * as acorn from 'acorn';
import { visit } from './ast.mjs';

export const managerSelector = 'does not match AppServerManager hostId';

// The manager now lives in app-shared. Register after all constructor fields,
// including the request transport and event dispatcher, have been initialized.
export function afterManagerInitialized(source, injection) {
  const tree = acorn.parse(source, {ecmaVersion:'latest', sourceType:'module'});
  const matches = new Map();
  visit(tree, (node, ancestors) => {
    const text=node.type==='TemplateElement'?node.value.raw:node.type==='Literal'?node.value:null;
    if (typeof text!=='string' || !text.includes(managerSelector)) return;
    const method = ancestors.findLast(n => n.type === 'MethodDefinition' && n.kind === 'constructor');
    if (method) matches.set(method.start, method.value);
  });
  if (matches.size !== 1) throw Error(`AppServerManager constructor: expected 1, found ${matches.size}`);
  const constructor = [...matches.values()][0];
  const end = constructor.body.end - 1;
  return source.slice(0, end) + ';' + injection + ';' + source.slice(end);
}
