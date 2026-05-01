const fs=require('fs');
const f='/home/ubuntu/mergetasks/dist/index.js';
let c=fs.readFileSync(f,'utf8');
const old='log26.error("LLM invocation failed:", errMsg);';
const alt='log26.error("copilot LLM invocation failed:", errMsg);';
const targets=[old,alt];
for(const t of targets){
  if(c.includes(t)){
    c=c.replace(t,t+'\nconsole.error("FULL_TRACE",llmErr.stack);');
    console.log('Found and patched:',t.slice(0,40));
  }
}
if(!c.includes('FULL_TRACE')){
  // brute force: find ANY catch that logs the type error
  c=c.replace(
    /catch\s*\(llmErr\)\s*\{/g,
    'catch(llmErr){console.error("FULL_TRACE",llmErr.stack);'
  );
  console.log('Patched all catch(llmErr) blocks');
}
fs.writeFileSync(f,c);
