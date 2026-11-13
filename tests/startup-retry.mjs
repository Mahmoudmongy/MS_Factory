import assert from 'node:assert/strict';
import { isRetryableStartupError, retryStartup } from '../js/startup-retry.mjs';

let calls = 0;
const value = await retryStartup(async () => {
  calls += 1;
  if (calls < 3) throw new TypeError('Failed to fetch');
  return 'connected';
}, { attempts: 3, delays: [0, 0] });
assert.equal(value, 'connected');
assert.equal(calls, 3, 'transient network errors retry only up to the configured limit');

let authCalls = 0;
await assert.rejects(retryStartup(async () => {
  authCalls += 1;
  const error = new Error('Unauthorized');
  error.status = 401;
  throw error;
}, { attempts: 4, delays: [0, 0, 0] }), /Unauthorized/);
assert.equal(authCalls, 1, 'authentication failures are not retried');

let conflictCalls = 0;
await assert.rejects(retryStartup(async () => {
  conflictCalls += 1;
  const error = new Error('FACTORY_RECORD_CONFLICT');
  error.code = 'FACTORY_RECORD_CONFLICT';
  throw error;
}, { attempts: 5, delays: [0, 0, 0, 0] }), /FACTORY_RECORD_CONFLICT/);
assert.equal(conflictCalls, 1, 'record conflicts are never retried');

assert.equal(isRetryableStartupError(Object.assign(new Error('temporary server failure'), { status: 503 })), true);
assert.equal(isRetryableStartupError(Object.assign(new Error('forbidden'), { status: 403 })), false);

let offlineCalls = 0;
await assert.rejects(retryStartup(async () => { offlineCalls += 1; const error = new Error('offline'); error.code = 'OFFLINE'; throw error; }, { attempts: 3, delays: [0, 0] }), /offline/);
assert.equal(offlineCalls, 1, 'offline startup errors are not retried while connectivity is absent');



let timeoutCalls = 0;
const afterTimeout = await retryStartup(() => { timeoutCalls += 1; return timeoutCalls === 1 ? new Promise(() => {}) : Promise.resolve('recovered'); }, { attempts: 2, delays: [0], timeoutMs: 5 });
assert.equal(afterTimeout, 'recovered');
assert.equal(timeoutCalls, 2, 'hung startup requests time out and retry only within the attempt limit');

console.log('PASS startup retry: bounded transient retries; no retries for auth, offline state or record conflicts.');
