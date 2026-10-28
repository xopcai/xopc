// This supervisor relays stdio only; pi continues to own JSON-RPC and the MCP session.
export const mcpStdioSupervisor = `
import {spawn} from 'node:child_process';
const p=JSON.parse(process.argv[1]);
const child=spawn(p.command,p.args,{cwd:p.cwd,env:process.env,detached:process.platform!=='win32',stdio:['pipe','pipe','ignore'],windowsHide:true});
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;try{if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else process.kill(-child.pid,'SIGTERM');}catch{}setTimeout(()=>{try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');}catch{}process.exit(0);},500);};
process.on('SIGTERM',stop);process.on('SIGINT',stop);process.stdin.on('end',stop);process.stdin.on('error',stop);
child.on('error',()=>{process.stderr.write('Local MCP executable could not start');process.exit(1);});
child.on('exit',code=>{stop();process.exitCode=code||0;});
process.stdin.pipe(child.stdin);child.stdin.on('error',()=>{});child.stdout.pipe(process.stdout);
`;
