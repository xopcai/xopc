import {readFileSync,writeFileSync} from 'node:fs';
import {summarize} from '../src/summarize.mjs';
writeFileSync('deliverables/result.json',JSON.stringify(summarize(JSON.parse(readFileSync('data/month.json','utf8'))),null,2)+'\n');
