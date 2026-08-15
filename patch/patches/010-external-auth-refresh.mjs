import { matchOnce, replaceOnce } from "../lib/anchor.mjs";

const ID_PATTERN = "case`currentTime/read`:this\\.dispatchMessageFromView\\(`mcp-response`,\\{hostId:this\\.hostId,response:\\{id:([A-Za-z_$][\\w$]*)\\(([A-Za-z_$][\\w$]*)\\)";
const REQUEST_PATTERN = "onRequest\\([A-Za-z_$][\\w$]*\\)\\{let\\{id:([A-Za-z_$][\\w$]*),method:[A-Za-z_$][\\w$]*,params:([A-Za-z_$][\\w$]*)\\}=";

export default {
  id: "010-external-auth-refresh",
  description: "External auth token refresh hook",
  glob: "webview/assets/app-initial-*.js",
  marker: "__codexpp?.authRefresh",
  apply(source) {
    const [, toRequestId, idVar] = matchOnce(source, ID_PATTERN, "istek id donusturucu");
    const [, destructuredId, paramsVar] = matchOnce(source, REQUEST_PATTERN, "onRequest ayristirma");

    if (idVar !== destructuredId) {
      throw new Error(`istek id degiskeni tutarsiz: ${idVar} ve ${destructuredId}`);
    }

    const send = (body) =>
      `_cxpHost.dispatchMessageFromView(\`mcp-response\`,{hostId:_cxpHost.hostId,response:${body}})`;

    const anchor = "case`account/chatgptAuthTokens/refresh`:case`attestation/generate`:break;";
    const replacement =
      "case`account/chatgptAuthTokens/refresh`:{" +
      `const _cxpHost=this,_cxpId=${toRequestId}(${idVar});` +
      `Promise.resolve(globalThis.__codexpp?.authRefresh?.(this.hostId,${paramsVar}))` +
      `.then(_cxpToken=>${send("_cxpToken?{id:_cxpId,result:_cxpToken}:{id:_cxpId,error:{code:-32603,message:`codexpp: hesap icin token bulunamadi`}}")})` +
      `.catch(_cxpErr=>${send("{id:_cxpId,error:{code:-32603,message:String(_cxpErr)}}")});` +
      "break}case`attestation/generate`:break;";

    return replaceOnce(source, anchor, replacement);
  }
};
