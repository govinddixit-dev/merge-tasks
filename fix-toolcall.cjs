const fs=require('fs');
const f='/home/ubuntu/mergetasks/dist/index.js';
let c=fs.readFileSync(f,'utf8');

// The problem: when pushing assistant message back, content must be null (not "")
// AND tool_calls must be included properly
// Current code: content: choice.message?.content || "",
// Fix: restore null, ensure tool_calls is passed correctly
c=c.replace(
  'content: choice.message?.content || "",',
  'content: choice.message?.content ?? null,'
);

// Remove debug trace
c=c.replace(/\nconsole\.error\("FULL_TRACE",llmErr\.stack\);/g,'');

// Remove debug LLM response logging if still there
c=c.replace(
  /const __r=await response\.json\(\);console\.log\("LLM_DEBUG_RESPONSE:".*?\);return __r;/g,
  'return await response.json();'
);

fs.writeFileSync(f,c);
console.log('Fixed tool_calls message format');
