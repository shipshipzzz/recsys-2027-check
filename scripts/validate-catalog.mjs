import {execFileSync} from 'node:child_process';
import {ROOT,KINDS,loadCatalogs,normalizeCatalogs,validatePrevious,counts,digest,cardId} from './catalog-data.mjs';
try{
  const args=process.argv.slice(2);
  if(args[0]==='--id'){
    console.log(cardId(args[1],args.slice(2).join(' ')));
  }else{
    const local=loadCatalogs();let tables=normalizeCatalogs(local);
    const baseIndex=args.indexOf('--base');
    if(baseIndex>=0){
      const ref=args[baseIndex+1];
      if(!/^[a-f0-9]{40}$/.test(ref??''))throw new Error('--base must be a full Git commit SHA');
      if(!/^0+$/.test(ref)){
        const previous=Object.fromEntries(KINDS.map(k=>[k,JSON.parse(execFileSync('git',['show',`${ref}:data/${k}.json`],{cwd:ROOT,encoding:'utf8',maxBuffer:10000000}))]));
        tables=validatePrevious(previous,local);
      }
    }
    console.log('Catalog validation passed:',JSON.stringify(counts(tables)));
    console.log('Payload SHA256:',digest(tables));
  }
}catch(error){console.error(error.message);process.exitCode=1;}
