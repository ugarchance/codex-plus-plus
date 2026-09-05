import * as acorn from "acorn";
import { visit } from "../lib/ast.mjs";

export default {
  id: "123-provider-picker",
  description:
    "Keep external effort choices separate from ChatGPT speed and maximum-usage hints",
  glob: "webview/assets/app-primary-*.js",
  select: "Locked, opens access options",
  marker: "__cxpExternalPicker",
  apply(source) {
    const ast = acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
    });
    const candidates = new Map();
    visit(ast, (node, ancestors) => {
      if (node.type !== "ObjectPattern") return;
      const keys = new Set(node.properties.map((p) => p.key?.name));
      if (
        ![
          "hasWorkModeAccess",
          "lockedModelSlug",
          "powerSelections",
          "modelPickerTriggerConfig",
        ].every((k) => keys.has(k))
      )
        return;
      const fn = ancestors.findLast((n) => n.type === "FunctionDeclaration");
      if (fn?.params[0]?.type === "Identifier") candidates.set(fn.start, fn);
    });
    if (candidates.size !== 1)
      throw Error("External picker prop contract is not unique");
    const fn = [...candidates.values()][0];
    const props = fn.params[0].name;
    const injection = `const __cxpExternalPicker=${props}.model?.startsWith('cxp/');if(__cxpExternalPicker){${props}={...${props},hasWorkModeAccess:true,selectedServiceTier:null,serviceTierOptions:[],powerSelections:${props}.powerSelections.map(p=>p.model?.startsWith('cxp/')?{...p,isMaximum:false}:p)};}`;
    return (
      source.slice(0, fn.body.start + 1) +
      injection +
      source.slice(fn.body.start + 1)
    );
  },
};
