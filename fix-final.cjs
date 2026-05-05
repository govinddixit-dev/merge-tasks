const fs=require('fs');
const f='/home/ubuntu/mergetasks/dist/index.js';
let c=fs.readFileSync(f,'utf8');

// Fix normalizeMessage to preserve tool_calls and tool_call_id
// Current: return { role, content: ... }
// Need: return { role, content: ..., ...original tool fields }

// The function ends with: return { role, content: "" };
// We need to add tool_calls preservation throughout

// Find: return { role, content: msg.content.text };
c=c.replace(
  /return \{ role, content: msg\.content\.text \};/,
  'return { role, content: msg.content.text, ...(msg.tool_calls ? {tool_calls: msg.tool_calls} : {}), ...(msg.tool_call_id ? {tool_call_id: msg.tool_call_id} : {}) };'
);

// Find all "return { role, content:" in normalizeMessage and add tool fields
// Pattern: return { role, content: blocks };
c=c.replace(
  'return { role, content: blocks };',
  'return { role, content: blocks, ...(msg.tool_calls ? {tool_calls: msg.tool_calls} : {}), ...(msg.tool_call_id ? {tool_call_id: msg.tool_call_id} : {}) };'
);

// Pattern: return { role, content: msg.content };  (string case)
c=c.replace(
  /return \{ role, content: msg\.content \};/,
  'return { role, content: msg.content, ...(msg.tool_calls ? {tool_calls: msg.tool_calls} : {}), ...(msg.tool_call_id ? {tool_call_id: msg.tool_call_id} : {}) };'
);

// The final fallback: return { role, content: "" };
c=c.replace(
  'return { role, content: "" };',
  'return { role, content: "", ...(msg.tool_calls ? {tool_calls: msg.tool_calls} : {}), ...(msg.tool_call_id ? {tool_call_id: msg.tool_call_id} : {}) };'
);

fs.writeFileSync(f,c);
console.log('normalizeMessage now preserves tool_calls and tool_call_id');
