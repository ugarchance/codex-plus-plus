const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.USER_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'cxp-usage-isolation-'));
process.env.CODEX_HOME=path.join(process.env.USER_DATA_DIR,'empty-home');
const store=require('../hub/store.cjs'),tokens=require('../hub/tokens.cjs'),probe=require('../hub/probe.cjs');
const usage=require('../hub/usage.cjs');
test('revoked accounts do not block valid quotas, and old percentages are not presented as current', async()=>{
 const originalToken=tokens.accessTokenFor,originalProbe=probe.readUsage;
 try{
  for(const order of [['bad','good'],['good','bad']]){
   store.write({version:1,accounts:order.map(id=>({id,accountId:id,label:id,usedPercent:43,windowMins:10080,usageAt:1}))});
   tokens.accessTokenFor=async a=>{if(a.id==='bad')throw Error('private refresh error');return 'fixture-only'};
   let probed;
   probe.readUsage=async credentials=>{probed=credentials.map(c=>c.id);return new Map([['good',{usedPercent:13,usageAt:Date.now(),usageWindows:{weekly:{usedPercent:13,windowMins:10080,resetAt:Date.now()+1000}}}]])};
   const view=await usage.refreshAll({force:true});
   assert.deepEqual(probed,['good']);
   assert.equal(view.accounts.find(a=>a.id==='good').usedPercent,13);
   assert.equal(view.accounts.find(a=>a.id==='good').usageError,null);
   const bad=view.accounts.find(a=>a.id==='bad');assert.equal(bad.usedPercent,null);assert.match(bad.usageError,/Sign in again/);assert.equal(JSON.stringify(view).includes('private refresh error'),false);
   tokens.accessTokenFor=async()=> 'fixture-only';
   probe.readUsage=async()=>new Map([['bad',{usedPercent:20,windowMins:10080,usageAt:Date.now()}]]);
   const restored=await usage.refreshAll({force:true});
   assert.equal(restored.accounts.find(a=>a.id==='bad').usageError,null);
   assert.equal(restored.accounts.find(a=>a.id==='good').usedPercent,null);
   assert.match(restored.accounts.find(a=>a.id==='good').usageError,/Unable to fetch usage/);
  }
 }finally{tokens.accessTokenFor=originalToken;probe.readUsage=originalProbe}
});
