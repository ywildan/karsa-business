import assert from "node:assert/strict";
import { test } from "node:test";
import { routeVercelRequest } from "../functions/vercel-request.js";

test("Vercel destination routing retains auth, method, and transaction JSON", async () => {
  const request = new Request("https://dashboard.example/api/index?route=/v2/sync", {
    method: "POST", headers: {Authorization:"Bearer test-token", "Content-Type":"application/json"},
    body: JSON.stringify({business:{id:"b"},products:[],transactions:[]}),
  });
  const mapped = routeVercelRequest(request);
  assert.equal(new URL(mapped.url).pathname,"/v2/sync");
  assert.equal(mapped.headers.get("Authorization"),"Bearer test-token");
  assert.equal(mapped.method,"POST");
  assert.deepEqual(await mapped.json(),{business:{id:"b"},products:[],transactions:[]});
});
test("original paths work and reserved route query cannot override them", () => {
  for (const path of ["/v1/snapshot","/v2/web/snapshot","/web-config","/health"]) {
    const mapped = routeVercelRequest(new Request(`https://dashboard.example${path}?route=/health`));
    assert.equal(new URL(mapped.url).pathname,path);
    assert.equal(new URL(mapped.url).searchParams.has("route"),false);
  }
});
test("rewrites cannot change the request origin", () => {
  const mapped=routeVercelRequest(new Request("https://dashboard.example/api/index?route=https://evil.example/v2/account"));
  assert.equal(new URL(mapped.url).origin,"https://dashboard.example");
  assert.equal(new URL(mapped.url).pathname,"/api/index");
});
