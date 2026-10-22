import type {
  ReducedRun,
  SpotCheckItem,
  UnresolvedItem,
  healthSummary,
  recentReports,
} from './service.ts';

export interface AdminPageData {
  health: Awaited<ReturnType<typeof healthSummary>>;
  reduced: ReducedRun[];
  unresolved: UnresolvedItem[];
  spot: SpotCheckItem[];
  reports: Awaited<ReturnType<typeof recentReports>>;
}

export const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const when = (iso: string) => esc(iso.replace('T', ' ').slice(0, 16) + 'Z');

function form(action: string, fields: Record<string, string | number>, button: string, cls = '') {
  const hidden = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return `<form method="post" action="${esc(action)}">${hidden}<button class="${cls}">${esc(button)}</button></form>`;
}

function reducedSection(items: ReducedRun[]): string {
  if (!items.length) return '<p class="muted">No reduced pages waiting.</p>';
  return items
    .map(
      (r) => `<div class="card warn"><div><b>${esc(r.city)}</b> ${esc(r.pageDate)}: ${r.rows} rows,
        previously ${r.previousRows ?? '?'} <span class="muted">(fetched ${when(r.fetchedAt)}, run ${r.runId})</span></div>
        <div class="muted">${esc(r.url)}</div>
        ${form(`/admin/runs/${r.runId}/confirm-reduced`, {}, 'Confirm as real')}</div>`,
    )
    .join('');
}

function unresolvedSection(items: UnresolvedItem[]): string {
  if (!items.length) return '<p class="muted">Nothing unresolved for upcoming outages.</p>';
  return items
    .map((u) => {
      const buttons = u.candidates
        .map((c) =>
          form(
            '/admin/unresolved/confirm',
            {
              segNorm: u.segNorm,
              [u.kind === 'village' ? 'settlementId' : 'streetId']: c.id,
              raw: u.name,
            },
            `${c.name} (${c.score.toFixed(2)})`,
          ),
        )
        .join('');
      return `<div class="card"><div><b>${esc(u.name)}</b>${u.kind === 'village' ? ' <span class="muted">(village)</span>' : ''}
        <span class="muted">${esc(u.municipality)}, ${u.outages} outage(s), first ${when(u.firstStart)}</span></div>
        <div class="muted">${u.samples.map(esc).join(' | ')}</div>
        <div class="row">${buttons || '<span class="muted">no candidates</span>'}
        ${searchForm(u.segNorm, u.name)}
        ${form('/admin/unresolved/dismiss', { segNorm: u.segNorm }, 'Not a street', 'ghost')}</div></div>`;
    })
    .join('');
}

function spotSection(items: SpotCheckItem[]): string {
  if (!items.length) return '<p class="muted">No auto-accepted matches to check.</p>';
  return items
    .map((s) => {
      const ids = s.rowIds.join(',');
      return `<div class="card"><div><b>${esc(s.rawSample)}</b> → <b>${esc(s.streetName)}</b>
        <span class="muted">score ${s.minScore.toFixed(2)}, ${s.outages} outage(s)</span></div>
        <div class="row">${form('/admin/spot-checks/review', { rowIds: ids, decision: 'confirmed' }, 'Correct')}
        ${form('/admin/spot-checks/review', { rowIds: ids, decision: 'rejected' }, 'Wrong', 'danger')}</div></div>`;
    })
    .join('');
}

const STYLE = '';

export function renderSearchPage(d: {
  segNorm: string;
  raw: string;
  query: string;
  kind: 'street' | 'village';
  hits: { id: number; name: string; municipality: string | null }[];
}): string {
  const buttons = d.hits
    .map((h) =>
      form(
        '/admin/unresolved/confirm',
        {
          segNorm: d.segNorm,
          [d.kind === 'village' ? 'settlementId' : 'streetId']: h.id,
          raw: d.raw,
        },
        `${h.name}${h.municipality ? ` (${h.municipality})` : ''}`,
      ),
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Search</title>
<style>${STYLE}body{font:15px system-ui,sans-serif;margin:0 auto;max-width:700px;padding:16px}form{margin:6px 0}</style></head><body>
<p><a href="/admin">Back</a></p><h1>${esc(d.raw || d.segNorm)}</h1>
${searchForm(d.segNorm, d.raw)}
<p>${d.hits.length ? 'Pick the right one:' : 'Nothing found.'}</p>${buttons}</body></html>`;
}

function searchForm(segNorm: string, raw: string): string {
  return `<form method="get" action="/admin/search"><input type="hidden" name="segNorm" value="${esc(segNorm)}">
<input type="hidden" name="raw" value="${esc(raw)}"><input name="q" placeholder="search by name" size="24"> <button class="ghost">Search</button></form>`;
}

export function renderAdminPage(d: AdminPageData): string {
  const h = d.health;
  const rate = h.resolutionRate === null ? 'n/a' : `${(h.resolutionRate * 100).toFixed(1)}%`;
  const scrapes = h.scrapes
    .map(
      (s) => `<tr><td>${esc(s.city)}</td><td class="muted">${esc(s.url.split('/').pop())}</td>
        <td>${when(s.startedAt)}</td><td>${esc(s.health ?? '-')}</td><td>${s.rows ?? '-'}</td>
        <td>${esc(s.pageDate ?? '-')}</td><td>${esc(s.error ?? '')}</td></tr>`,
    )
    .join('');
  const alerts = h.alerts.length
    ? h.alerts
        .map(
          (a) =>
            `<li><b>${esc(a.kind)}</b> ${esc(a.message)} <span class="muted">${when(a.createdAt)}</span></li>`,
        )
        .join('')
    : '<li class="muted">No open alerts.</li>';
  const delivery = Object.entries(h.delivery24h)
    .map(([k, v]) => `${esc(k)} ${v}`)
    .join(', ');
  const reports = d.reports.length
    ? d.reports
        .map(
          (r) => `<div class="card"><div>${esc(r.message)}</div>
        <div class="muted">${when(r.createdAt)} · outage ${r.outageId ?? '-'} ${esc(r.municipality ?? '')} ${esc(r.date ?? '')}</div>
        <div class="muted">${esc(r.rawStreets ?? '')}</div></div>`,
        )
        .join('')
    : '<p class="muted">No reports.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Struja Alert admin</title>
<style>
body{font:15px/1.45 system-ui,sans-serif;margin:0 auto;max-width:960px;padding:16px;color:#1b1b1f;background:#fafafc}
h1{font-size:20px}h2{font-size:17px;margin-top:28px}
.card{background:#fff;border:1px solid #dcdce2;border-radius:10px;padding:10px 12px;margin:8px 0}
.card.warn{border-color:#d29b00;background:#fff8e1}
.row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.row form{margin:0}
.muted{color:#6b6b76;font-size:13px}
button{font:inherit;border:1px solid #3b5bdb;background:#3b5bdb;color:#fff;border-radius:8px;padding:5px 10px;cursor:pointer}
button.ghost{background:#fff;color:#1b1b1f;border-color:#b5b5be}button.danger{background:#c92a2a;border-color:#c92a2a}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #e6e6ea;padding:4px 6px;text-align:left}
.stats{display:flex;flex-wrap:wrap;gap:8px 20px}
@media (prefers-color-scheme:dark){body{background:#131316;color:#e8e8ec}.card{background:#1d1d22;border-color:#34343c}
.card.warn{background:#2c2410}button.ghost{background:#1d1d22;color:#e8e8ec;border-color:#4a4a54}td,th{border-color:#2c2c33}.muted{color:#9a9aa6}}
</style></head><body>
<h1>Struja Alert admin</h1>
<div class="stats"><span>Upcoming outages: <b>${h.upcomingOutages}</b></span>
<span>Resolution: <b>${rate}</b> (${h.segments.unresolved} of ${h.segments.total} segments unresolved)</span>
<span>Spot checks 30d: <b>${h.spotChecks30d.rejected}</b> wrong of ${h.spotChecks30d.total}</span>
<span>Devices <b>${h.devices}</b>, addresses <b>${h.subscriptions}</b></span>
<span>Notifications 24h: ${delivery || 'none'}</span></div>
<h2>Open alerts</h2><ul>${alerts}</ul>
<h2>Reduced pages</h2>${reducedSection(d.reduced)}
<h2>Unresolved queue (${d.unresolved.length})</h2>${unresolvedSection(d.unresolved)}
<h2>Spot check: auto-accepted matches (${d.spot.length})</h2>${spotSection(d.spot)}
<h2>Latest fetch per page</h2>
<table><tr><th>City</th><th>Page</th><th>Fetched</th><th>Health</th><th>Rows</th><th>Date</th><th>Note</th></tr>${scrapes}</table>
<h2>Reports from the app</h2>${reports}
</body></html>`;
}
