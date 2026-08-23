#!/usr/bin/env node

import assert from "node:assert/strict";
import vm from "node:vm";

import patch060 from "../patch/patches/060-app-server-client.mjs";

const fixture = [
  "class Example{",
  "constructor(host){if(host!==`local`)throw new Error(`does not match AppServerManager hostId ${host}`);this.hostId=host,void 0}",
  "async getAccount(options){return this.sendRequest(`account/read`,{refreshToken:!1},options)}",
  "async sendRequest(method,params){calls.push({type:`request`,method,accountId:params.chatgptAccountId});return {}}",
  "}",
].join("");
const patched = patch060.apply(fixture);

const calls = [];
const timerDelays = [];
const context = {
  calls,
  setTimeout(callback, delay) {
    timerDelays.push(delay);
    callback();
  },
};
context.globalThis = context;
context.__codexpp = {
  accountsSync() {
    return { defaultAccountId: "saved-account", activeAccountId: "saved-account" };
  },
  async activate(accountId) {
    calls.push({ type: "activate", accountId });
    return {
      ok: true,
      credentials: {
        accessToken: "test-access-token",
        chatgptAccountId: "test-chatgpt-account",
        chatgptPlanType: "pro",
      },
      view: { activeAccountId: accountId },
    };
  },
};

vm.runInNewContext(`${patched};globalThis.Example=Example`, context);
const client = new context.Example("local");
await client.getAccount({ source: "startup" });

assert.deepEqual(
  calls.map((call) => call.type),
  ["activate", "request", "request"],
  "startup account/read must wait until the saved account is re-applied to a fresh app-server",
);
assert.equal(calls[0].accountId, "saved-account");
assert.equal(calls[1].method, "account/login/start");
assert.equal(calls[2].method, "account/read");
assert.deepEqual(timerDelays, [], "the first restore attempt should run after a microtask, not a timer");

console.log("[PASS] startup restore re-applies the saved account to a fresh app-server");
