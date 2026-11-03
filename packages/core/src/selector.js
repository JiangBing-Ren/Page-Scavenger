export function cssPath(el) {
  if (!el || el.nodeType !== 1) return '';
  if (el.id) {
    try {
      return '#' + CSS.escape(el.id);
    } catch (e) {
      return '#' + el.id;
    }
  }

  const parts = [];
  let cur = el;
  let guard = 0;

  while (cur && cur.nodeType === 1 && cur !== document.documentElement && guard++ < 12) {
    let sel = cur.localName;
    const parent = cur.parentElement;
    if (parent) {
      const currentTag = cur.localName;
      const sameTag = Array.from(parent.children).filter((c) => c.localName === currentTag);
      if (sameTag.length > 1) sel += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
    }
    parts.unshift(sel);
    if (cur.id) {
      try {
        parts[0] = '#' + CSS.escape(cur.id);
      } catch (e) {
        parts[0] = '#' + cur.id;
      }
      break;
    }
    cur = parent;
  }

  return parts.join(' > ');
}

export function safeMatches(el, sel) {
  try {
    return el.matches(sel);
  } catch (e) {
    return false;
  }
}

export function matchesAny(el, list) {
  for (let i = 0; i < list.length; i++) {
    if (safeMatches(el, list[i])) return true;
  }
  return false;
}
