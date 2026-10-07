import { describe, it, expect } from 'vitest';
import { linkifySegments } from '../linkify';

function hrefs(text: string) {
  return linkifySegments(text).filter(segment => segment.href).map(segment => ({
    text: segment.text,
    href: segment.href,
  }));
}

describe('linkifySegments', () => {
  it('returns plain text when there is no URL', () => {
    expect(linkifySegments('Meet at the trailhead.')).toEqual([
      { text: 'Meet at the trailhead.' },
    ]);
    expect(linkifySegments('')).toEqual([]);
  });

  it('links http(s) and www URLs and keeps the surrounding sentence', () => {
    expect(linkifySegments('Notes at https://example.com/trail. Also www.park.org/map')).toEqual([
      { text: 'Notes at ' },
      { text: 'https://example.com/trail', href: 'https://example.com/trail' },
      { text: '. Also ' },
      { text: 'www.park.org/map', href: 'https://www.park.org/map' },
    ]);
  });

  it('preserves http, localhost, query strings, and line breaks', () => {
    const text = 'Gate: http://localhost:5173/map?b=1&c=2\nThen https://example.com.';
    expect(linkifySegments(text)).toEqual([
      { text: 'Gate: ' },
      { text: 'http://localhost:5173/map?b=1&c=2', href: 'http://localhost:5173/map?b=1&c=2' },
      { text: '\nThen ' },
      { text: 'https://example.com', href: 'https://example.com/' },
      { text: '.' },
    ]);
  });

  it('keeps parentheses that belong to the URL and drops wrapping ones', () => {
    expect(hrefs('See (https://example.com/path) today')).toEqual([
      { text: 'https://example.com/path', href: 'https://example.com/path' },
    ]);
    expect(hrefs('https://en.wikipedia.org/wiki/URL_(disambiguation).')).toEqual([
      {
        text: 'https://en.wikipedia.org/wiki/URL_(disambiguation)',
        href: 'https://en.wikipedia.org/wiki/URL_(disambiguation)',
      },
    ]);
  });

  it('does not link bare domains, emails, or non-http schemes', () => {
    expect(hrefs('Visit example.com or email me@example.com.')).toEqual([]);
    expect(hrefs('user@www.example.com')).toEqual([]);
    expect(hrefs('javascript:alert(1)')).toEqual([]);
    expect(hrefs('Use https:// in the note')).toEqual([]);
  });

  it('links an explicit IPv4 address', () => {
    expect(hrefs('http://127.0.0.1:3002/api')).toEqual([
      { text: 'http://127.0.0.1:3002/api', href: 'http://127.0.0.1:3002/api' },
    ]);
  });
});
