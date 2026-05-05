const fs=require('fs');
const f='/home/ubuntu/mergetasks/dist/index.js';
let c=fs.readFileSync(f,'utf8');

// Nuclear option: in invokeOpenAICompatible, skip normalizeMessage entirely
// Just pass messages through as-is since they're already in OpenAI format
// Find the messages line in the payload construction
c=c.replace(
  /messages: messages\.filter\(Boolean\)\.map\(normalizeMessage\)\.map\(m =>[\s\S]*?\}\)/,
  'messages: messages.filter(Boolean)'
);
// Also catch the original if above didn't match
c=c.replace(
  'messages: messages.filter(Boolean).map(normalizeMessage)',
  'messages: messages.filter(Boolean)'
);
c=c.replace(
  'messages: messages.map(normalizeMessage)',
  'messages: messages.filter(Boolean)'
);

fs.writeFileSync(f,c);
console.log('Bypassed normalizeMessage for OpenAI path');
