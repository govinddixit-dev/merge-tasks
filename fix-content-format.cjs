const fs=require('fs');
const f='/home/ubuntu/mergetasks/dist/index.js';
let c=fs.readFileSync(f,'utf8');

// The normalizeMessage converts Array content into blocks array
// with {type:"text"} objects. OpenAI doesn't accept this for
// assistant/tool messages. Fix: flatten array content to string
// when all parts are text.

// Find the normalizeMessage function and add a final step
// that converts content blocks back to string if possible

// Simpler approach: in invokeOpenAICompatible, flatten messages
// before sending. Find: messages: messages.filter(Boolean).map(normalizeMessage)
const old = 'messages: messages.filter(Boolean).map(normalizeMessage)';
if (c.includes(old)) {
  c = c.replace(old, `messages: messages.filter(Boolean).map(normalizeMessage).map(m => {
    if (Array.isArray(m.content)) {
      const textOnly = m.content.every(p => typeof p === 'string' || (p && p.type === 'text'));
      if (textOnly) {
        return { ...m, content: m.content.map(p => typeof p === 'string' ? p : p.text || '').join('') };
      }
    }
    return m;
  })`);
  console.log('Fix: flatten content blocks to string for OpenAI');
} else {
  // Try without the filter(Boolean) we added earlier
  const old2 = 'messages: messages.map(normalizeMessage)';
  if (c.includes(old2)) {
    c = c.replace(old2, `messages: messages.filter(Boolean).map(normalizeMessage).map(m => {
      if (Array.isArray(m.content)) {
        const textOnly = m.content.every(p => typeof p === 'string' || (p && p.type === 'text'));
        if (textOnly) {
          return { ...m, content: m.content.map(p => typeof p === 'string' ? p : p.text || '').join('') };
        }
      }
      return m;
    })`);
    console.log('Fix: flatten content blocks to string for OpenAI (alt)');
  } else {
    console.log('Could not find target');
  }
}

fs.writeFileSync(f,c);
