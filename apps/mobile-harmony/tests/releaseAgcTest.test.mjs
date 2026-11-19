import assert from 'node:assert/strict';
import { test } from 'node:test';

import { releaseAgcTest } from '../scripts/release-agc-test.mjs';

const build = { versionName: '0.1.37', versionCode: 38 };
const group = { groupId: 'internal-group', groupName: 'xopc 内测', groupType: 1, addedTestersNum: 1 };
const pkg = { packageId: '123', ...build };
const version = { versionId: '456', state: 7, releaseType: 6, testType: 3, packageList: [pkg] };

function mockHuawei(t, { existing = [], groupId = group.groupId, auditOpinion, reviewState } = {}) {
  const requests = [];
  let submitted = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    requests.push({ path: url.pathname, method: options.method, body });
    if (url.pathname.endsWith('/test-group/list')) {
      assert.equal(url.searchParams.get('groupType'), '1');
      return Response.json({ rtnCode: 0, groups: [group] });
    }
    const ret = { code: 0 };
    if (url.pathname.endsWith('/brief-info/list')) return Response.json({ ret, versionList: existing });
    if (url.pathname.endsWith('/compile/status')) return Response.json({ ret, pkgStateList: [{ pkgId: '123', successStatus: 0 }] });
    if (url.pathname.endsWith('/app-package-info')) return Response.json({ ret, packageInfo: pkg });
    if (url.pathname.endsWith('/app-info')) {
      return Response.json({
        ret, appInfo: { releaseState: 7, reviewState: submitted ? 1 : reviewState, versionNumber: '0.1.37', versionCode: 38 },
        auditInfo: auditOpinion && { auditOpinion },
        openTestInfo: { testTaskInfo: { groupInfos: [{ groupId, bind: 1 }] } },
      });
    }
    if (url.pathname.endsWith('/submit')) submitted = true;
    return Response.json({ ret, versionId: '456' });
  });
  return requests;
}

test('resumes from a Huawei package ID and confirms review after binding only the internal group', async (t) => {
  const requests = mockHuawei(t);
  const startedAt = Date.now();
  await releaseAgcTest(build, 'unused.app', 'internal', group.groupName, '123');
  const versionWrites = requests.filter(({ path, method }) => path.includes('/test/app/version') && method !== 'GET');
  assert.deepEqual(versionWrites.map(({ method }) => method), ['POST', 'PUT', 'POST']);
  const binding = versionWrites[1].body;
  assert.equal(binding.pkgId, '123');
  assert(binding.openTestInfo.startTime >= startedAt && binding.openTestInfo.startTime <= Date.now());
  assert.equal(binding.openTestInfo.endTime - binding.openTestInfo.startTime, 14 * 86400_000);
  assert.deepEqual(binding.openTestInfo.testTaskInfo.groupInfos, [{ groupId: group.groupId, groupName: group.groupName, addedTesterNum: 1, bind: 1 }]);
  assert.deepEqual(versionWrites[2].body, { versionId: '456' });
  assert.equal(requests.at(-1).path, '/api/publish/v3/app-info');
});

test('never submits a draft when Huawei echoes a different audience', async (t) => {
  const requests = mockHuawei(t, { groupId: 'wrong-group' });
  await assert.rejects(releaseAgcTest(build, 'unused.app', 'internal', group.groupName, '123'), /exactly the requested AppTest group/);
  assert(!requests.some(({ path }) => path.endsWith('/submit')));
});

test('does not change a build already approved even while Huawei reports release state 7', async (t) => {
  const requests = mockHuawei(t, { existing: [version], auditOpinion: '{"zh_CN":"====应用上架审核通过===="}' });
  await releaseAgcTest(build, 'unused.app', 'internal', group.groupName);
  assert(!requests.some(({ path }) => path.includes('/test/app/version')));
});

test('requires operator inspection for an existing opinion that does not confirm approval', async (t) => {
  const requests = mockHuawei(t, { existing: [version], auditOpinion: 'Review did not pass' });
  await assert.rejects(releaseAgcTest(build, 'unused.app', 'internal', group.groupName), /already has a review result/);
  assert(!requests.some(({ path }) => path.includes('/test/app/version')));
});
