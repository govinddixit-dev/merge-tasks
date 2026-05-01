const fs = require('fs');
const f = '/home/ubuntu/mergetasks/dist/index.js';
let c = fs.readFileSync(f, 'utf8');
let n = 0;

// Fix 1: convertResponse - for (const block of resp.content)
const old1 = 'for (const block of resp.content) {';
if (c.includes(old1)) {
  c = c.replace(old1, 'for (const block of (resp.content || [])) { if (!block) continue;');
  n++; console.log('Fix 1: convertResponse null safety');
}

// Fix 2: convertMessage map - part.type when part could be null
// In the msg.content.map callback, add null guard
const old2 = 'const blocks = msg.content.map((part) => {';
if (c.includes(old2)) {
  c = c.replace(old2, 'const blocks = msg.content.filter(Boolean).map((part) => {');
  n++; console.log('Fix 2: convertMessage null filter');
}

// Fix 3: normalizeContentPart - also guard against null parts  
const old3 = 'messages: messages.map(normalizeMessage)';
if (c.includes(old3)) {
  c = c.replace(old3, 'messages: messages.filter(Boolean).map(normalizeMessage)');
  n++; console.log('Fix 3: normalizeMessage null filter');
}

// Fix 4: Undo the broken debug patch
c = c.replace(
  /copilot LLM invocation failed \(STACK:.*?\):/g,
  'copilot LLM invocation failed:'
);
console.log('Fix 4: Removed debug patch');

fs.writeFileSync(f, c);
console.log('\nTotal: ' + n + ' fixes applied');
