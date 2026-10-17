import assert from 'node:assert/strict';
import test from 'node:test';

test('staff PIN actions persist hashes, reject duplicates and verify without plaintext', async () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = await import('../src/lib/store.js');
  await store.addStaff('Tunde', '2345');
  const person = store.getState().staff.find(value => value.name === 'Tunde');
  assert.equal(person.pin, undefined);
  assert(person.pinHash);
  assert.equal(await store.switchStaff('2345'), true);
  assert.equal(await store.switchStaff('9999'), false);
  await assert.rejects(store.addStaff('Other', '2345'));
  await store.setStaffPin(person.id, '5678');
  assert.equal(await store.switchStaff('2345'), false);
  assert.equal(await store.switchStaff('5678'), true);
});

test('legacy staff PINs migrate to hashes using a device salt and preserve names', async () => {
  const { migrateStaffPins, hashPin } = await import('../src/lib/staffPins.js');
  const migrated = await migrateStaffPins([{ id: 'owner', name: 'Ngozi', pin: '1234', isOwner: true }]);
  assert.equal(migrated[0].pin, undefined);
  assert.equal(migrated[0].name, 'Ngozi');
  const otherDevice = await hashPin('1234', btoa('a different device salt of 32 b!!'));
  assert.notEqual(otherDevice.hash, migrated[0].pinHash.hash);
});
