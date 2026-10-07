export interface LinkSegment {
  text: string;
  href?: string;
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

// Sentence punctuation that is almost never part of the URL itself.
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"', ']', '}', '*', '…']);

function isAcceptableHost(hostname: string): boolean {
  if (!hostname) return false;
  const withoutRootDot = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  const labels = withoutRootDot.split('.');
  if (labels.some(label => label.length === 0)) return false;
  if (withoutRootDot === 'localhost') return true;
  return labels.length >= 2;
}

function hrefFor(url: string): string | null {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!isAcceptableHost(parsed.hostname)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function trimMatch(raw: string): { url: string; trailing: string } {
  let end = raw.length;
  while (end > 0) {
    const ch = raw[end - 1];
    if (ch === ')') {
      // Keep a closing paren that belongs to the URL, such as a Wikipedia title.
      let opens = 0;
      let closes = 0;
      for (let i = 0; i < end; i++) {
        if (raw[i] === '(') opens++;
        else if (raw[i] === ')') closes++;
      }
      if (closes <= opens) break;
      end--;
      continue;
    }
    if (!TRAILING_PUNCTUATION.has(ch)) break;
    end--;
  }
  return { url: raw.slice(0, end), trailing: raw.slice(end) };
}

function pushText(segments: LinkSegment[], text: string) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.href === undefined) last.text += text;
  else segments.push({ text });
}

export function linkifySegments(text: string): LinkSegment[] {
  if (!text) return [];
  const segments: LinkSegment[] = [];
  const re = new RegExp(URL_PATTERN);
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > 0 && text[match.index - 1] === '@') continue;
    const { url, trailing } = trimMatch(match[0]);
    const href = hrefFor(url);
    if (!href) continue;
    pushText(segments, text.slice(cursor, match.index));
    segments.push({ text: url, href });
    pushText(segments, trailing);
    cursor = match.index + match[0].length;
  }
  pushText(segments, text.slice(cursor));
  return segments;
}
