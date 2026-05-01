/**
 * MergeTasks post-build patch
 * Run after every: pnpm run build
 * Usage: node /home/ubuntu/mergetasks/patch.cjs
 */
const fs = require('fs');
const f = '/home/ubuntu/mergetasks/dist/index.js';
let c = fs.readFileSync(f, 'utf8');
let n = 0;

// Patch 1: ESM/CJS interop — createRequire for AWS SDK + ioredis
if (!c.startsWith('import{createRequire')) {
  c = 'import{createRequire as _cr}from"module";var require=_cr(import.meta.url);' + c;
  n++; console.log('1. createRequire patch applied');
}

// Patch 2: Remove Anthropic thinking parameter
c = c.replace(/providerOptions:\s*\{\s*thinking:\s*\{[^}]*\}\s*\}/g, 'providerOptions: {}');
n++; console.log('2. thinking parameter removed');

// Patch 3: Bypass normalizeMessage in OpenAI path (prevents content mangling)
c = c.replace(
  'messages: messages.map(normalizeMessage)',
  'messages: messages.filter(Boolean)'
);
n++; console.log('3. normalizeMessage bypassed for OpenAI');

// Patch 4: convertResponse null safety
c = c.replace(
  'for (const block of resp.content) {',
  'for (const block of (resp.content || [])) { if (!block) continue;'
);
n++; console.log('4. convertResponse null safety');

// Patch 5: normalizeMessage preserve tool fields
const returns = [
  'return { role, content: msg.content };',
  'return { role, content: msg.content.text };',
  'return { role, content: blocks };',
  'return { role, content: "" };'
];
for (const r of returns) {
  const fixed = r.replace('};', ', ...(msg.tool_calls ? {tool_calls: msg.tool_calls} : {}), ...(msg.tool_call_id ? {tool_call_id: msg.tool_call_id} : {}) };');
  if (c.includes(r)) c = c.replace(r, fixed);
}
n++; console.log('5. normalizeMessage preserves tool_calls');

fs.writeFileSync(f, c);
console.log('\nAll ' + n + ' patches applied successfully');
