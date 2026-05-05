const fs=require('fs');
const f='/home/ubuntu/mergetasks/dist/index.js';
let c=fs.readFileSync(f,'utf8');

// Add logging right before the return in invokeOpenAICompatible
c=c.replace(
  'return await response.json();',
  'const __r=await response.json();console.log("LLM_DEBUG_RESPONSE:",JSON.stringify(__r).slice(0,500));return __r;'
);

fs.writeFileSync(f,c);
console.log('Debug logging added');
