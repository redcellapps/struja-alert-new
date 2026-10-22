// Minimal robots.txt evaluation: the group for our user-agent token if present, else "*";
// the longest matching rule wins and Allow beats Disallow on a tie.
interface Rule {
  allow: boolean;
  path: string;
}

export function parseRobots(text: string, uaToken: string): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: field === 'allow', path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const token = uaToken.toLowerCase();
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = own.length > 0 ? own : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function matches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith('$');
  const pattern = (anchored ? rulePath.slice(0, -1) : rulePath)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
}

export function isAllowed(rules: Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!matches(r.path, path)) continue;
    if (
      !best ||
      r.path.length > best.path.length ||
      (r.path.length === best.path.length && r.allow)
    ) {
      best = r;
    }
  }
  return best ? best.allow : true;
}
