import assert from "node:assert/strict";
import vm from "node:vm";
import patch from "../patch/patches/010-external-auth-refresh.mjs";
import mainAuth from "../patch/patches/080-main-auth-token.mjs";

for (const modern of [false, true]) {
  const response = modern
    ? "this.sendAppServerResponse(method,{id:mapId($id),result:{currentTimeAt:0}})"
    : "this.dispatchMessageFromView(`mcp-response`,{hostId:this.hostId,response:{id:mapId($id),result:{currentTimeAt:0}}})";
  const source = "class Manager{hostId=`local`;onRequest(request){let{id:$id,method:method,params:params}=request;switch(method){case`currentTime/read`:" + response + ";break;case`account/chatgptAuthTokens/refresh`:case`attestation/generate`:break;}}" +
    "sendAppServerResponse(method,response){responses.push({method,response})}dispatchMessageFromView(method,envelope){responses.push({method,response:envelope.response})}};globalThis.Manager=Manager;";
  for (const outcome of ["success", "missing", "error"]) {
    const responses = [], calls = [];
    const credentials = { accessToken: "fixture-only" };
    const context = { responses, mapId: id => `mapped-${id}`, __codexpp: { authRefresh: async (host, params) => {
      calls.push({host,params});
      if(outcome === "error") throw Error("fixture failure");
      return outcome === "success" ? credentials : null;
    } } };
    vm.runInNewContext(patch.apply(source), context);
    new context.Manager().onRequest({id:7,method:"account/chatgptAuthTokens/refresh",params:{reason:"expired"}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.length,1);
    assert.equal(calls[0].host,"local");
    assert.equal(calls[0].params.reason,"expired");
    assert.equal(responses.length,1);
    assert.equal(responses[0].response.id,"mapped-7");
    assert.equal(responses[0].method,modern?"account/chatgptAuthTokens/refresh":"mcp-response");
    if(outcome === "success") assert.equal(responses[0].response.result,credentials);
    else assert.equal(responses[0].response.error.code,-32603);
  }
}
const oldGate = 'r?.authMethod===`chatgpt`?r.authToken??null:null';
const nativeGate = 'r?.authMethod===`chatgpt`||r?.authMethod===`chatgptAuthTokens`?r.authToken??null:null';
for(const gate of [oldGate,nativeGate]) {
  const patched = mainAuth.apply(`function a(r){return ${gate}}function b(r){return ${gate}}`);
  const ctx={};vm.runInNewContext(patched,ctx);
  for(const fn of [ctx.a,ctx.b]) {
    assert.equal(fn({authMethod:"chatgptAuthTokens",authToken:"fixture"}),"fixture");
    assert.equal(fn({authMethod:"chatgpt",authToken:"fixture"}),"fixture");
    assert.equal(fn({authMethod:"apikey",authToken:"fixture"}),null);
    assert.equal(fn(null),null);
  }
}
assert.throws(()=>mainAuth.apply(`function a(r){return ${nativeGate}}`),/match twice/);
console.log("Auth refresh: old/new response transports, success/missing/error, native/legacy token gates passed");
