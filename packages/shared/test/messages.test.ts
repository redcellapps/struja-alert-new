import { describe, expect, it } from 'vitest';
import { renderMessage, type MessageInput } from '../src/messages.ts';

// 22 Oct 2026 is a Thursday. Belgrade is UTC+2 until 25 Oct.
const NOW = new Date('2026-10-22T09:00:00Z'); // 11:00 local
const at = (iso: string) => new Date(iso);
const street = { latin: 'Vojvode Mišića', cyrillic: 'Војводе Мишића' };

const base = (over: Partial<MessageInput> = {}): MessageInput => ({
  kind: 'new',
  street,
  houseNumber: '34',
  window: { startsAt: at('2026-10-27T07:30:00Z'), endsAt: at('2026-10-27T11:30:00Z') }, // Tue 27 Oct 08:30-12:30 local (winter time, UTC+1)
  now: NOW,
  ...over,
});

describe('sr-Latn: the BRIEF §5 templates', () => {
  const o = { script: 'latn', locale: 'sr' } as const;
  it('new', () => {
    expect(renderMessage(base(), o).title).toBe(
      'Isključenje struje: Vojvode Mišića 34, utorak 27.10. 08:30–12:30',
    );
  });
  it('evening_before', () => {
    const m = renderMessage(base({ kind: 'evening_before', now: at('2026-10-26T17:15:00Z') }), o);
    expect(m.title).toBe('Sutra bez struje: Vojvode Mišića 34, 08:30–12:30');
  });
  it('changed', () => {
    expect(renderMessage(base({ kind: 'changed' }), o).title).toBe(
      'Izmena: Vojvode Mišića 34, novo vreme 08:30–12:30',
    );
  });
  it('cancelled', () => {
    expect(renderMessage(base({ kind: 'cancelled' }), o).title).toBe(
      'Otkazano: isključenje utorak 27.10., Vojvode Mišića 34',
    );
  });
  it('says "danas" and "sutra" instead of a weekday', () => {
    const today = base({
      window: { startsAt: at('2026-10-22T13:00:00Z'), endsAt: at('2026-10-22T15:00:00Z') },
    });
    expect(renderMessage(today, o).title).toContain('danas 15:00–17:00');
    const tomorrow = base({
      window: { startsAt: at('2026-10-23T06:00:00Z'), endsAt: at('2026-10-23T08:00:00Z') },
    });
    expect(renderMessage(tomorrow, o).title).toContain('sutra 08:00–10:00');
  });
  it('uses winter time after the change (26 Oct, UTC+1)', () => {
    const m = renderMessage(
      base({
        window: { startsAt: at('2026-10-27T07:30:00Z'), endsAt: at('2026-10-27T09:30:00Z') },
      }),
      o,
    );
    expect(m.title).toContain('08:30–10:30');
  });
  it('omits the house number when none was saved', () => {
    expect(renderMessage(base({ houseNumber: '' }), o).title).toContain('Vojvode Mišića,');
  });
  it('uses ekavica and a source line', () => {
    const m = renderMessage(base(), o);
    expect(m.body).toBe('Izvor: Elektrodistribucija Srbije.');
    expect(JSON.stringify(renderMessage(base({ kind: 'changed' }), o))).not.toMatch(
      /ijeme|vrijeme/,
    );
  });
});

describe('sr-Cyrl is generated from sr-Latn, with the gazetteer’s Cyrillic street', () => {
  const o = { script: 'cyrl', locale: 'sr' } as const;
  it('new', () => {
    expect(renderMessage(base(), o).title).toBe(
      'Искључење струје: Војводе Мишића 34, уторак 27.10. 08:30–12:30',
    );
  });
  it('changed and cancelled', () => {
    expect(renderMessage(base({ kind: 'changed' }), o).title).toBe(
      'Измена: Војводе Мишића 34, ново време 08:30–12:30',
    );
    expect(renderMessage(base({ kind: 'cancelled' }), o).title).toBe(
      'Отказано: искључење уторак 27.10., Војводе Мишића 34',
    );
  });
  it('evening_before', () => {
    expect(
      renderMessage(base({ kind: 'evening_before', now: at('2026-10-26T17:15:00Z') }), o).title,
    ).toBe('Сутра без струје: Војводе Мишића 34, 08:30–12:30');
  });
  it('body is Cyrillic too', () => {
    expect(renderMessage(base(), o).body).toBe('Извор: Електродистрибуција Србије.');
  });
});

describe('"Moguće pogođeno"', () => {
  const o = { script: 'latn', locale: 'sr' } as const;
  it('labels a match the user cannot be sure about, with the reason', () => {
    const m = renderMessage(base({ houseNumber: '', possible: 'no_number' }), o);
    expect(m.title).toBe('Moguće pogođeno: Vojvode Mišića, utorak 27.10. 08:30–12:30');
    expect(m.body).toContain('Moguće pogođeno.');
    expect(m.body).toContain('Niste uneli kućni broj');
  });
  it('has its own wording per kind and reason', () => {
    expect(renderMessage(base({ kind: 'evening_before', possible: 'partial' }), o).title).toBe(
      'Sutra moguće bez struje: Vojvode Mišića 34, 08:30–12:30',
    );
    expect(renderMessage(base({ kind: 'changed', possible: 'unresolved' }), o).title).toContain(
      'Izmena (moguće pogođeno)',
    );
    expect(renderMessage(base({ possible: 'unresolved' }), o).body).toContain(
      'nije sa sigurnošću prepoznata',
    );
  });
  it('says that several streets share the name when the notice does not place it', () => {
    expect(renderMessage(base({ possible: 'same_name' }), o).body).toContain(
      'Više ulica nosi ovo ime, a obaveštenje ne kaže koja je.',
    );
    expect(
      renderMessage(base({ possible: 'same_name' }), { script: 'latn', locale: 'en' }).body,
    ).toContain('Several streets have this name and the notice does not say which.');
  });
  it('is generated in Cyrillic as well', () => {
    expect(
      renderMessage(base({ possible: 'partial' }), { script: 'cyrl', locale: 'sr' }).title,
    ).toBe('Могуће погођено: Војводе Мишића 34, уторак 27.10. 08:30–12:30');
  });
});

describe('several new windows in one "Izmena"', () => {
  const o = { script: 'latn', locale: 'sr' } as const;
  it('lists them instead of guessing which one replaced which', () => {
    const m = renderMessage(
      base({
        kind: 'changed',
        window: { startsAt: at('2026-10-27T07:30:00Z'), endsAt: at('2026-10-27T09:30:00Z') },
        moreWindows: [{ startsAt: at('2026-10-27T13:00:00Z'), endsAt: at('2026-10-27T15:00:00Z') }],
      }),
      o,
    );
    expect(m.title).toBe('Izmena: Vojvode Mišića 34, nova vremena 08:30–10:30, 14:00–16:00');
  });
});

describe('reinstated (an undone cancellation)', () => {
  it('sr-Latn: "Isključenje ipak važi"', () => {
    expect(
      renderMessage(base({ kind: 'reinstated' }), { script: 'latn', locale: 'sr' }).title,
    ).toBe('Isključenje ipak važi: Vojvode Mišića 34, utorak 27.10. 08:30–12:30');
  });
  it('sr-Cyrl is generated from it', () => {
    expect(
      renderMessage(base({ kind: 'reinstated' }), { script: 'cyrl', locale: 'sr' }).title,
    ).toBe('Искључење ипак важи: Војводе Мишића 34, уторак 27.10. 08:30–12:30');
  });
  it('en: "Outage reinstated"', () => {
    expect(
      renderMessage(base({ kind: 'reinstated' }), { script: 'latn', locale: 'en' }).title,
    ).toBe('Outage reinstated: Vojvode Mišića 34, Tuesday 27.10. 08:30–12:30');
  });
});

describe('English', () => {
  const o = { script: 'latn', locale: 'en' } as const;
  it('has all four kinds', () => {
    expect(renderMessage(base(), o).title).toBe(
      'Power outage: Vojvode Mišića 34, Tuesday 27.10. 08:30–12:30',
    );
    expect(renderMessage(base({ kind: 'changed' }), o).title).toBe(
      'Update: Vojvode Mišića 34, new time 08:30–12:30',
    );
    expect(renderMessage(base({ kind: 'cancelled' }), o).title).toBe(
      'Cancelled: outage Tuesday 27.10., Vojvode Mišića 34',
    );
    expect(
      renderMessage(base({ kind: 'evening_before', now: at('2026-10-26T17:15:00Z') }), o).title,
    ).toContain('Tomorrow without power');
  });
  it('labels possible matches', () => {
    expect(renderMessage(base({ possible: 'no_number' }), o).title).toContain('Possibly affected');
  });
});
