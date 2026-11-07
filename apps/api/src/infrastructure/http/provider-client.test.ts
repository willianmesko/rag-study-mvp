import assert from "node:assert/strict";
import test from "node:test";
import {
  maxProviderResponseBytes,
  requestProviderJson,
} from "./provider-client.js";
test("an oversized provider response is cancelled before JSON decoding", async (t) => {
  let cancelled = false;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(maxProviderResponseBytes + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      ),
  );
  await assert.rejects(
    requestProviderJson("https://fixture.example.test", {}),
    /size limit/,
  );
  assert.equal(cancelled, true);
});

test('provider rate-limit retries retain one deadline; ambiguous paid failures and permanent responses never replay', async t => {
  const { requestProviderResponse } = await import('./provider-client.js');
  let attempts = 0, deadline: AbortSignal | null | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    attempts++;
    if (deadline) assert.equal(init.signal, deadline); else deadline = init.signal;
    return attempts === 1 ? new Response('PRIVATE_UPSTREAM_SENTINEL', { status: 429, headers: { 'retry-after': '1' } }) : Response.json({ ok: true });
  });
  let waited = 0;
  await requestProviderResponse('https://provider.example.com', { method: 'POST' }, { wait: async ms => { waited = ms; } });
  assert.equal(attempts, 2); assert.ok(waited >= 1000);
  for (const status of [400, 401, 403, 408, 500, 503]) {
    attempts = 0;
    t.mock.method(globalThis, 'fetch', async () => { attempts++; return new Response('PRIVATE_UPSTREAM_SENTINEL', { status }); });
    await assert.rejects(requestProviderResponse('https://provider.example.com', { method: 'POST' }), error => error instanceof Error && !error.message.includes('PRIVATE_'));
    assert.equal(attempts, 1);
  }
  attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => { attempts++; throw new TypeError('PRIVATE_NETWORK_SENTINEL'); });
  await assert.rejects(requestProviderResponse('https://provider.example.com', { method: 'POST' }), /transport_unknown/);
  assert.equal(attempts, 1);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(requestProviderResponse('https://provider.example.com', { signal: cancelled.signal }));
  assert.equal(attempts, 1);
});

test('rate-limit attempts cannot bypass a workflow call ceiling',async t=>{
  const {withTransientBudget}=await import('../../application/workflows/transient-budget.js');
  const {workflowEffect}=await import('../../application/workflows/execution-context.js');
  const {requestProviderResponse}=await import('./provider-client.js');
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(null,{status:429});});
  await assert.rejects(withTransientBudget({maxSteps:3,maxCalls:1,maxInputTokens:1000,maxOutputTokens:100,maxCostMicros:1000,timeoutMs:1000},()=>workflowEffect('chat:fixture',{}, {calls:1},()=>requestProviderResponse('https://fixture.example.com',{method:'POST'},{wait:async()=>{}}))),/budget_exceeded/);
  assert.equal(calls,1);
});
