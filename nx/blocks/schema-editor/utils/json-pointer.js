const WHITESPACE = /\s/;

function skipWhitespace(text, from) {
  let index = from;
  while (index < text.length && WHITESPACE.test(text[index])) index += 1;
  return index;
}

function skipString(text, from) {
  let index = from + 1;
  while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
  return index + 1;
}

function skipValue(text, from) {
  let depth = 0;
  let index = from;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      index = skipString(text, index);
      if (depth === 0) return index;
    } else if (char === '{' || char === '[') {
      depth += 1;
      index += 1;
    } else if (char === '}' || char === ']') {
      if (depth === 0) return index;
      depth -= 1;
      index += 1;
      if (depth === 0) return index;
    } else if (char === ',' && depth === 0) {
      return index;
    } else {
      index += 1;
    }
  }
  return index;
}

// Returns the last matching member because JSON.parse lets duplicate keys win last.
function findMember({ text, objectStart, key }) {
  let match;
  let index = skipWhitespace(text, objectStart + 1);
  while (text[index] === '"') {
    const keyStart = index;
    const keyEnd = skipString(text, keyStart);
    const valueStart = skipWhitespace(text, skipWhitespace(text, keyEnd) + 1);
    if (JSON.parse(text.slice(keyStart, keyEnd)) === key) match = { keyStart, valueStart };
    index = skipWhitespace(text, skipValue(text, valueStart));
    if (text[index] !== ',') return match;
    index = skipWhitespace(text, index + 1);
  }
  return match;
}

/**
 * Returns the text offset of the object key a key path points to, so editors
 * can jump to a definition without re-parsing into a syntax tree.
 */
export function findKeyOffset({ text, pointer }) {
  try {
    const target = pointer.reduce((member, key) => {
      if (text[member?.valueStart] !== '{') return undefined;
      return findMember({ text, objectStart: member.valueStart, key });
    }, { keyStart: 0, valueStart: skipWhitespace(text, 0) });
    return target?.keyStart;
  } catch {
    return undefined;
  }
}
