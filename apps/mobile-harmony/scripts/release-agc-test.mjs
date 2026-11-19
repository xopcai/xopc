import { appendFileSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { agcRequest } from './agc-auth.mjs';
import { registerAgcTestPackage, waitAgcTestPackage } from './register-agc-test-package.mjs';
import { uploadAgcApp } from './upload-agc-app.mjs';

const appId = '6917618744771171142';
const bundleName = 'ai.xopc.xopc';
const versionPath = '/api/publish/v2/test/app/version';
const reviewStates = { 1: 'waiting for review', 2: 'under review' };
const releaseStates = { 0: 'testing', 3: 'scheduled', 4: 'under review', 12: 'pre-review' };

function record(message) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
}

function requireId(value, label) {
  if (typeof value !== 'string' || !/^[\w-]{1,32}$/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function url(path, query) {
  return `${path}?${new URLSearchParams(query)}`;
}

function exactBuild(pkg, build) {
  return pkg?.versionName === build.versionName && Number(pkg.versionCode) === build.versionCode;
}

function status(detail) {
  const state = detail.appInfo?.releaseState;
  return releaseStates[state] ?? (state === 7 ? reviewStates[detail.appInfo?.reviewState] ?? approvedOpinion(detail) : undefined);
}

function approvedOpinion(detail) {
  const opinion = detail.auditInfo?.auditOpinion;
  if (typeof opinion === 'string' && opinion.includes('====应用上架审核通过====')) return 'Huawei review approved';
  return undefined;
}

async function queryTests() {
  const data = await agcRequest('/api/publish/v3/version/brief-info/list', {
    method: 'POST', headers: { appId }, body: { packageName: bundleName }, label: 'List AGC versions', retry: true,
  });
  if (!Array.isArray(data.versionList)) throw new Error('Huawei did not return the version list.');
  return data.versionList.filter((v) => v.releaseType === 6 && v.testType === 3);
}

function queryVersion(versionId) {
  return agcRequest(url('/api/publish/v3/app-info', { appId, versionId, releaseType: 6 }), {
    label: 'Read AGC test version', retry: true,
  });
}

async function findGroup(type, name) {
  const matches = [];
  for (let page = 1; ; page++) {
    const data = await agcRequest(url('/api/app-test/v1/test-group/list', { groupType: type, current: page, pageSize: 10 }), {
      headers: { appId }, label: 'List AppTest groups', retry: true, appTest: true,
    });
    matches.push(...(data.groups ?? []).filter((group) => group.groupType === type && group.groupName === name));
    if (page >= (data.pageInfo?.totalPage ?? 1)) break;
    if (page >= 100) throw new Error('Unexpected number of AppTest group pages.');
  }
  if (matches.length !== 1 || !matches[0].addedTestersNum) throw new Error(`Expected one populated AppTest group named ${name}.`);
  requireId(matches[0].groupId, 'AppTest group ID');
  return matches[0];
}

function checkAudience(detail, group) {
  const bound = detail.openTestInfo?.testTaskInfo?.groupInfos?.filter((item) => item.bind === 1) ?? [];
  if (bound.length !== 1 || bound[0].groupId !== group.groupId) throw new Error('Huawei did not bind exactly the requested AppTest group.');
}

async function waitForSubmission(versionId, group) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const detail = await queryVersion(versionId);
    checkAudience(detail, group);
    const phase = status(detail);
    if (phase) return phase;
    if (detail.appInfo?.releaseState !== 7 || detail.auditInfo?.auditOpinion) {
      throw new Error(`Huawei reported release state ${detail.appInfo?.releaseState ?? 'unknown'} for ${versionId}.`);
    }
    if (attempt < 19) await delay(10_000);
  }
  throw new Error(`Huawei has not confirmed submission for ${versionId}. Check the version before submitting again.`);
}

export async function releaseAgcTest(build, packagePath, channel, groupName, resumePkg, resumeVersion) {
  const group = await findGroup(channel === 'internal' ? 1 : 0, groupName);
  const tests = await queryTests();
  const bound = tests.filter((v) => v.packageList?.some((pkg) => exactBuild(pkg, build)));
  if (bound.length > 1) throw new Error('Multiple matching AGC drafts exist. Resolve them in Huawei before rerunning.');
  if (resumeVersion && bound.length && bound[0].versionId !== resumeVersion) {
    throw new Error('The provided version ID differs from the version already bound to this build.');
  }

  const description = `xopc ${build.versionName} ${channel === 'internal' ? '内部测试' : '外部测试'}`;
  if (description.length > 30) throw new Error('AGC test description exceeds 30 characters.');
  let versionId = bound[0]?.versionId ?? resumeVersion;
  let pkgId = bound[0]?.packageList.find((pkg) => exactBuild(pkg, build)).packageId;
  if (pkgId && resumePkg && pkgId !== resumePkg) throw new Error('The provided package ID differs from the bound build.');
  pkgId ??= resumePkg;

  if (versionId) {
    requireId(versionId, 'test version ID');
    const entry = tests.find((v) => v.versionId === versionId);
    if (!entry || (entry.packageList?.length && !bound.length)) throw new Error('The version ID belongs to a different build.');
    const detail = await queryVersion(versionId);
    if (bound.length) checkAudience(detail, group);
    else if (detail.openTestInfo?.testDesc !== description) throw new Error('The unbound draft has a different description.');
    const phase = status(detail);
    if (phase && bound.length) {
      record(`xopc ${build.versionName} (${build.versionCode}) already submitted to ${groupName}: ${phase}. Version ID: ${versionId}.`);
      return;
    }
    if (detail.appInfo?.releaseState !== 7 || detail.auditInfo?.auditOpinion || detail.appInfo?.reviewState != null) {
      throw new Error(`Version ${versionId} already has a review result or is no longer a draft. Check Huawei before proceeding.`);
    }
  } else {
    // Recover the draft by its deterministic description if the create request succeeded before the run stopped.
    const unbound = tests.filter((v) => v.state === 7 && !v.packageList?.length);
    for (const entry of unbound) {
      const detail = await queryVersion(entry.versionId);
      if (detail.openTestInfo?.testDesc !== description) continue;
      if (versionId) throw new Error('Multiple unbound drafts match this release. Provide the correct version ID.');
      versionId = requireId(entry.versionId, 'test version ID');
    }
  }

  if (!pkgId) {
    const upload = await uploadAgcApp(appId, packagePath);
    record(`Uploaded ${basename(packagePath)}. Huawei object ID: ${upload.objectId}.`);
    pkgId = await registerAgcTestPackage(appId, upload.objectId, upload.fileName);
  }
  requireId(pkgId, 'package ID');
  record(`Huawei package ID (resume_package_id): ${pkgId}.`);
  await waitAgcTestPackage(appId, pkgId);
  const { packageInfo } = await agcRequest(url('/api/publish/v2/app-package-info', { packageId: pkgId }), {
    headers: { appId }, label: 'Check parsed AGC package identity', retry: true,
  });
  if (packageInfo?.packageId !== pkgId || !exactBuild(packageInfo, build)) throw new Error('Parsed package does not match the selected xopc build.');

  const draftPath = url(versionPath, { appId });
  if (!versionId) {
    const created = await agcRequest(draftPath, {
      method: 'POST', body: { releaseType: 6, testType: 3, testDesc: description, onshelfSelfDetect: 0 }, label: 'Create AGC test draft',
    });
    versionId = requireId(created.versionId, 'test version ID');
  }
  record(`Huawei test version ID (resume_version_id): ${versionId}.`);
  const startTime = Date.now() + (channel === 'internal' ? 0 : 15 * 60_000);
  await agcRequest(draftPath, {
    method: 'PUT', label: 'Bind AGC test package and group',
    body: {
      versionId, pkgId,
      openTestInfo: {
        startTime, endTime: startTime + 14 * 86400_000, testDesc: description,
        testTaskInfo: {
          groupInfos: [{ groupId: group.groupId, groupName, addedTesterNum: group.addedTestersNum, bind: 1 }],
          displayArea: '1', needNotify: 0, needShareLink: 0,
        },
      },
    },
  });
  const configured = await queryVersion(versionId);
  checkAudience(configured, group);
  const actual = { versionName: configured.appInfo?.versionNumber, versionCode: configured.appInfo?.versionCode };
  if (!exactBuild(actual, build)) throw new Error('The draft version does not match the selected xopc build.');
  await agcRequest(url(`${versionPath}/submit`, { appId }), {
    method: 'POST', body: { versionId }, label: 'Submit AGC test version',
  });
  record(`Huawei accepted the submission request for ${versionId}.`);
  const phase = await waitForSubmission(versionId, group);
  record(`xopc ${build.versionName} (${build.versionCode}) submitted to ${groupName}: ${phase}.`);
}

if (import.meta.main) {
  try {
    const [buildInfo, packagePath] = process.argv.slice(2);
    const { HARMONY_RELEASE_CHANNEL: channel, HARMONY_RELEASE_EXPECTED_VERSION: expected,
      HARMONY_RELEASE_GROUP: externalGroup, HARMONY_RESUME_PACKAGE_ID: resumePkg,
      HARMONY_RESUME_VERSION_ID: resumeVersion } = process.env;
    const build = JSON.parse(readFileSync(buildInfo, 'utf8'));
    if (build.bundleName !== bundleName || !/^\d+\.\d+\.\d+$/.test(expected ?? '') ||
      build.versionName !== expected || !Number.isSafeInteger(build.versionCode) || build.versionCode <= 0) {
      throw new Error(`Expected xopc version ${expected || '(missing)'}, but built ${build.versionName} (${build.versionCode}).`);
    }
    if (channel === 'verify') {
      record(`Huawei Connect API verified for xopc. Found ${(await queryTests()).length} invitation test version(s).`);
    } else {
      if (channel !== 'internal' && channel !== 'external') throw new Error('Choose internal or external AppTest.');
      if (channel === 'external' && !externalGroup?.trim()) throw new Error('An existing external test group is required.');
      if (resumePkg) requireId(resumePkg, 'package ID');
      if (resumeVersion) requireId(resumeVersion, 'test version ID');
      if (!packagePath?.endsWith('.app')) throw new Error('Expected a signed .app.');
      await releaseAgcTest(build, packagePath, channel, channel === 'internal' ? 'xopc 内测' : externalGroup.trim(), resumePkg, resumeVersion);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
