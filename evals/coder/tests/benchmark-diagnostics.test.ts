import { expect, it } from 'vitest';

import { summarizeToolTrace } from '../apps/cli/src/benchmark-diagnostics.js';

it('counts repeated successful calls only at an observed stable revision and keeps missing coverage unknown', () => {
  const events: Record<string,unknown>[] = [];
  const start = (id:string, name:string) => events.push({type:'tool.started',payload_json:JSON.stringify({turnIndex:0,payload:{toolCallId:id,toolName:name,args:{path:'input.json'}}})});
  const end = (id:string, revision:string, check=false) => events.push({type:'tool.finished',payload_json:JSON.stringify({turnIndex:0,payload:{toolCallId:id,status:'success',result:{details:{workspaceRevision:revision,...(check?{verification:{kind:'check',status:'passed'}}:{})}}}})});
  start('1','read_file');end('1','a');
  start('2','read_file');end('2','a');
  start('3','read_file');end('3','a');
  start('4','exec_command');end('4','a',true);
  start('5','read_file');end('5','a');
  start('6','write_file');end('6','b');
  start('7','read_file');end('7','b');
  const result=summarizeToolTrace(events,[]);
  expect(result.repeatedSuccessfulCallsAtObservedRevision).toBe(2);
  expect(result.explicitEditsAfterSuccessfulCheckAtObservedRevision).toBe(1);
  expect(result.explicitReadsAfterSuccessfulCheckAtObservedRevision).toBe(1);
  expect(result.distinctExplicitReadPaths).toEqual(['input.json']);
  events.push({type:'tool.finished',payload_json:'{"truncated":true}',artifact_refs_json:'[]'});
  expect(summarizeToolTrace(events,[]).repeatedSuccessfulCallsAtObservedRevision).toBeNull();
});
