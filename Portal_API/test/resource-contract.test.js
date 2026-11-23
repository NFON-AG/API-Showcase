const assert = require('node:assert/strict');
const test = require('node:test');
const { writeFixture } = require('./helpers/fixture.cjs');

// Check the JSON received by the provider, not just the local success response.
// The live provider requires serviceNumber to be a JSON integer for both services.
for (const [kind, collection] of [['queues', 'queue-services'], ['skills', 'skill-services']]) {
  for (const input of ['731', 731, '0', 0]) {
    test(`${kind}: explicit serviceNumber ${JSON.stringify(input)} (${typeof input}) is sent as an integer`, async t => {
      const app = await writeFixture(t);
      const result = await app.request(`/api/resources/${kind}`, {
        displayName: 'Contract service', serviceNumber: input, extensionNumber: '7600',
      });
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.body.created, true);
      const writes = await app.control('writes');
      assert.equal(writes.length, 1);
      assert.equal(writes[0].method, 'POST');
      assert.equal(writes[0].path, `/api/customers/K9001/targets/${collection}`);
      const fields = JSON.parse(writes[0].body).data;
      assert.equal(fields.find(field => field.name === 'serviceNumber')?.value, Number(input));
      assert.equal(fields.find(field => field.name === 'extensionNumber')?.value, '7600');
    });
  }

  for (const input of ['', undefined, null]) {
    test(`${kind}: ${input === '' ? 'blank' : String(input)} serviceNumber preserves provider auto-assignment`, async t => {
      const app = await writeFixture(t);
      const result = await app.request(`/api/resources/${kind}`, {
        displayName: 'Auto-assigned contract service', serviceNumber: input,
      });
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.body.created, true);
      const writes = await app.control('writes');
      assert.equal(writes.length, 1);
      const fields = JSON.parse(writes[0].body).data;
      assert.equal(fields.some(field => field.name === 'serviceNumber'), false);
      assert.equal(fields.some(field => field.name === 'extensionNumber'), false);
      assert.equal(result.body.resource.routeNumber, '700');
      assert.ok((await app.control('state'))[kind].includes(result.body.resource.routeNumber));
    });
  }
}
