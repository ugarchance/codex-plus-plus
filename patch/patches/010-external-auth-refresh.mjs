import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

const ID_PATTERN = "case`currentTime/read`:this\\.dispatchMessageFromView\\(`mcp-response`,\\{hostId:this\\.hostId,response:\\{id:([A-Za-z_$][\\w$]*)\\(([A-Za-z_$][\\w$]*)\\)";
const REQUEST_PATTERN = "onRequest\\([A-Za-z_$][\\w$]*\\)\\{let\\{id:([A-Za-z_$][\\w$]*),method:[A-Za-z_$][\\w$]*,params:([A-Za-z_$][\\w$]*)\\}=";

export default {
  id: "010-external-auth-refresh",
  description: "External auth token refresh hook",
  glob: "webview/assets/app-initial-*.js",
  marker: "__codexpp?.authRefresh",
  apply(source) {
    // New desktop releases route responses through the manager so forwarding
    // and request bookkeeping happen before IPC dispatch.
    const modern = "case`currentTime/read`:this\\.sendAppServerResponse\\(([A-Za-z_$][\\w$]*),\\{id:([A-Za-z_$][\\w$]*)\\(([A-Za-z_$][\\w$]*)\\),result:";
    if (new RegExp(modern).test(source)) {
      const [, method, mapper, id] = matchOnce(source, modern, "server response request id mapper");
      const [, destructuredId, params] = matchOnce(source, REQUEST_PATTERN, "onRequest destructuring");
      if (id !== destructuredId) throw new Error("request id variable mismatch");
      const anchor = "case`account/chatgptAuthTokens/refresh`:case`attestation/generate`:break;";
      return replaceOnce(source, anchor,
        "case`account/chatgptAuthTokens/refresh`:{" +
        `const _cxpHost=this,_cxpId=${mapper}(${id});` +
        `Promise.resolve(globalThis.__codexpp?.authRefresh?.(this.hostId,${params}))` +
        `.then(_cxpToken=>_cxpHost.sendAppServerResponse(${method},_cxpToken?{id:_cxpId,result:_cxpToken}:{id:_cxpId,error:{code:-32603,message:\`codexpp: no token for this account\`}}))` +
        `.catch(_cxpErr=>_cxpHost.sendAppServerResponse(${method},{id:_cxpId,error:{code:-32603,message:String(_cxpErr)}}));` +
        "break}case`attestation/generate`:break;");
    }
    const [, toRequestId, idVar] = matchOnce(source, ID_PATTERN, "request id mapper");
    const [, destructuredId, paramsVar] = matchOnce(source, REQUEST_PATTERN, "onRequest destructuring");

    if (idVar !== destructuredId) {
      throw new Error(`request id variable mismatch: ${idVar} and ${destructuredId}`);
    }

    const send = (body) =>
      `_cxpHost.dispatchMessageFromView(\`mcp-response\`,{hostId:_cxpHost.hostId,response:${body}})`;

    const anchor = "case`account/chatgptAuthTokens/refresh`:case`attestation/generate`:break;";
    const replacement =
      "case`account/chatgptAuthTokens/refresh`:{" +
      `const _cxpHost=this,_cxpId=${toRequestId}(${idVar});` +
      `Promise.resolve(globalThis.__codexpp?.authRefresh?.(this.hostId,${paramsVar}))` +
      `.then(_cxpToken=>${send("_cxpToken?{id:_cxpId,result:_cxpToken}:{id:_cxpId,error:{code:-32603,message:`codexpp: no token for this account`}}")})` +
      `.catch(_cxpErr=>${send("{id:_cxpId,error:{code:-32603,message:String(_cxpErr)}}")});` +
      "break}case`attestation/generate`:break;";

    return replaceOnce(source, anchor, replacement);
  }
};
