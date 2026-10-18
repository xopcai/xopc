import {readFileSync} from 'node:fs';
import {resolveOAuthPath} from '../../../../src/config/paths.ts';
import {resolveApiKey} from '../../../../src/auth/credentials.ts';
export async function readCurrentCloudAccess(keys){
 const remember=record=>{for(const key of [record.access,record.refresh])if(key&&!keys.includes(key))keys.push(key);};
 remember(JSON.parse(readFileSync(resolveOAuthPath('xopc-cloud'),'utf8')));
 const access=await resolveApiKey('xopc-cloud');
 const record=JSON.parse(readFileSync(resolveOAuthPath('xopc-cloud'),'utf8'));remember(record);
 if(!access||record.expiresAt<=Date.now())throw new Error('OAuth access unavailable after authorized standard renewal; no model substitution.');
 return {access,expiresAt:record.expiresAt,source:'user-authorized-standard-OAuth-renewal-credential-file-only'};
}
