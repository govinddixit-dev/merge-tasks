const fs=require('fs');
const f='/home/ubuntu/mergetasks/dist/index.js';
let c=fs.readFileSync(f,'utf8');

// Fix: change content: choice.message?.content || null to default to empty string
// This prevents null content from being pushed into messages array
c=c.replace(
  'content: choice.message?.content || null,',
  'content: choice.message?.content || "",'
);

// Also remove debug logging
c=c.replace(
  /const __r=await response\.json\(\);console\.log\("LLM_DEBUG_RESPONSE:".*?\);return __r;/g,
  'return await response.json();'
);

fs.writeFileSync(f,c);
console.log('Fixed null content + removed debug');
