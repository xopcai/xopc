import {test} from 'node:test';import assert from 'node:assert/strict';import {summarize} from '../src/summarize.mjs';
test('summary handles normal and empty rows',()=>{assert.deepEqual(summarize([{cents:4},{cents:6}]),{rowCount:2,totalCents:10});assert.deepEqual(summarize([]),{rowCount:0,totalCents:0});});
