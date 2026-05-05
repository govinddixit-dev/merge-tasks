const fs=require('fs');
const f='/home/ubuntu/mergetasks/dist/index.js';
let c=fs.readFileSync(f,'utf8');

// Replace ALL part.type and block.type with optional chaining
c=c.replace(/\bpart\.type\b/g,'part?.type');
c=c.replace(/\bblock\.type\b/g,'block?.type');

// Clean up debug patch
c=c.replace('copilot LLM invocation failed [STACK]: ','copilot LLM invocation failed:');

fs.writeFileSync(f,c);
console.log('All .type accesses patched with optional chaining');
