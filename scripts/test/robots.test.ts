import { describe, expect, it } from 'vitest';
import { isAllowed, parseRobots } from '../src/collector/robots.ts';

const robots = `
User-agent: *
Disallow: /admin/
Disallow: /planirana-iskljucenja-srbija/private
Allow: /planirana-iskljucenja-srbija/private/ok

User-agent: BadBot
Disallow: /
`;

describe('robots.txt', () => {
  const rules = parseRobots(robots, 'StrujaAlert');
  it('allows paths not disallowed', () => {
    expect(isAllowed(rules, '/planirana-iskljucenja-srbija/Nis_Dan_0_Iskljucenja.htm')).toBe(true);
  });
  it('blocks disallowed paths and honours longer Allow rules', () => {
    expect(isAllowed(rules, '/admin/x')).toBe(false);
    expect(isAllowed(rules, '/planirana-iskljucenja-srbija/private/a')).toBe(false);
    expect(isAllowed(rules, '/planirana-iskljucenja-srbija/private/ok/a')).toBe(true);
  });
  it('does not apply another bot group to us', () => {
    expect(isAllowed(rules, '/anything')).toBe(true);
  });
  it('uses our own group when present', () => {
    const own = parseRobots(
      'User-agent: StrujaAlert\nDisallow: /\n\nUser-agent: *\nAllow: /',
      'StrujaAlert/0.0.0 (+mailto:a@b.rs)',
    );
    expect(isAllowed(own, '/x')).toBe(false);
  });
  it('allows everything for an empty file', () => {
    expect(isAllowed(parseRobots('', 'StrujaAlert'), '/x')).toBe(true);
  });
});
