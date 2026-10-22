import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationLog } from '../src/db/schema.ts';
import { createWorld, type World } from './helpers/world.ts';

// "What a person was last told must match what EDS shows now." Every real state change after the
// first is told again (revision in the dedupe key); a repeat run with nothing new sends nothing.
let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w?.stop();
});

const A = 'Студеничке';
const keep: [string, string, string] = ['Палилула - Ниш', '20:00 - 21:00', 'Требињске'];

describe('a time that flips A -> B -> A -> B', () => {
  it('tells the person every flip, so they never keep believing the old time', async () => {
    const date = '10.11.2026.';
    const a = await w.addSub({ norm: 'studenicka' });
    const early: [string, string, string] = ['Пантелеј', '08:00 - 10:00', A];
    const late: [string, string, string] = ['Пантелеј', '09:00 - 11:00', A];

    await w.page(date, [early, keep]);
    await w.plan();
    await w.deliver();
    for (const next of [late, early, late, early]) {
      await w.page(date, [next, keep]);
      await w.plan();
      await w.deliver();
    }

    const told = w.titles(a.token);
    expect(told).toHaveLength(5);
    expect(told[0]).toMatch(/^Isključenje struje: .+ 08:00–10:00$/);
    expect(told[1]).toMatch(/novo vreme 09:00–11:00$/);
    expect(told[2]).toMatch(/novo vreme 08:00–10:00$/);
    expect(told[3]).toMatch(/novo vreme 09:00–11:00$/);
    // the last thing they were told is what EDS shows now
    expect(told[4]).toMatch(/novo vreme 08:00–10:00$/);
    // every flip after the first is a new revision of the row it returns to
    expect(await w.kinds(a.subId)).toEqual([
      'new:sent:0',
      'changed:sent:0',
      'changed:sent:1',
      'changed:sent:1',
      'changed:sent:2',
    ]);
  });

  it('a repeat run with nothing new sends nothing', async () => {
    const date = '10.11.2026.';
    await w.page(date, [['Пантелеј', '08:00 - 10:00', A], keep]);
    const again = await w.plan();
    expect(again.planned).toBe(0);
    expect((await w.deliver()).sent).toBe(0);
  });
});

describe('an undone cancellation is "reinstated"', () => {
  const date = '11.11.2026.';
  const row: [string, string, string] = ['Палилула - Ниш', '08:00 - 10:00', 'Космајске'];

  it('only people who were told "Otkazano" hear "Isključenje ipak važi"', async () => {
    const told = await w.addSub({ norm: 'kosmajska' });
    await w.page(date, [row, keep]);
    await w.plan();
    await w.deliver();
    await w.page(date, [keep]);
    await w.page(date, [keep]); // gone twice: cancelled
    await w.plan();
    await w.deliver();
    expect(w.titles(told.token)[1]).toMatch(/^Otkazano: isključenje .+, Kosmajska$/);

    // someone who joined during the cancellation was never told about this outage
    const never = await w.addSub({ norm: 'kosmajska' });
    await w.page(date, [row, keep]); // EDS publishes it again
    await w.plan();
    await w.deliver();

    expect(w.titles(told.token)).toHaveLength(3);
    expect(w.titles(told.token)[2]).toMatch(/^Isključenje ipak važi: Kosmajska, .+ 08:00–10:00$/);
    // They never heard of it, so for them it is a plain new outage; "reinstated" is only for people
    // who were told "Otkazano".
    expect(w.titles(never.token)).toHaveLength(1);
    expect(w.titles(never.token)[0]).toMatch(/^Isključenje struje: Kosmajska, /);
    expect(await w.kinds(never.subId)).toEqual(['new:sent:0']);
    expect(await w.kinds(told.subId)).toEqual([
      'new:sent:0',
      'cancelled:sent:1',
      'reinstated:sent:2',
    ]);
  });

  it('uses the Izmena channel, and sr-Cyrl / en copy', async () => {
    const date2 = '12.11.2026.';
    const cyr = await w.addSub({ norm: 'kosmajska', script: 'cyrl' });
    const en = await w.addSub({ norm: 'kosmajska', locale: 'en' });
    const r: [string, string, string] = ['Палилула - Ниш', '08:00 - 10:00', 'Космајске'];
    await w.page(date2, [r, keep]);
    await w.plan();
    await w.deliver();
    await w.page(date2, [keep]);
    await w.page(date2, [keep]);
    await w.plan();
    await w.deliver();
    await w.page(date2, [r, keep]);
    await w.plan();
    await w.deliver();
    expect(w.titles(cyr.token).at(-1)).toMatch(/^Искључење ипак важи: Космајска, .+ 08:00–10:00$/);
    expect(w.titles(en.token).at(-1)).toMatch(/^Outage reinstated: Kosmajska, .+ 08:00–10:00$/);
    const msg = w.provider.sent.filter((m) => m.to === en.token).at(-1);
    expect(msg?.channelId).toBe('changed');
  });

  it('every cancel/reinstate cycle is told: cancelled, reinstated, cancelled again, reinstated again', async () => {
    const date3 = '13.11.2026.';
    const a = await w.addSub({ norm: 'kosmajska' });
    const r: [string, string, string] = ['Палилула - Ниш', '08:00 - 10:00', 'Космајске'];
    await w.page(date3, [r, keep]);
    await w.plan();
    await w.deliver();
    for (let cycle = 0; cycle < 2; cycle++) {
      await w.page(date3, [keep]);
      await w.page(date3, [keep]);
      await w.plan();
      await w.deliver();
      await w.page(date3, [r, keep]);
      await w.plan();
      await w.deliver();
    }
    expect(await w.kinds(a.subId)).toEqual([
      'new:sent:0',
      'cancelled:sent:1',
      'reinstated:sent:2',
      'cancelled:sent:3',
      'reinstated:sent:4',
    ]);
    expect((await w.plan()).planned).toBe(0); // and nothing more on a repeat
  });

  it('an "Otkazano" still waiting in quiet hours is withdrawn when the outage is back', async () => {
    const date4 = '14.11.2026.';
    const a = await w.addSub({ norm: 'kosmajska' });
    const r: [string, string, string] = ['Палилула - Ниш', '10:00 - 11:00', 'Космајске'];
    await w.page(date4, [r, keep]);
    await w.plan();
    await w.deliver();
    const night = new Date('2026-11-13T22:30:00Z'); // 23:30 local: quiet hours
    await w.page(date4, [keep], night);
    await w.page(date4, [keep], night);
    await w.plan(night); // "Otkazano" is planned but held until 07:00
    await w.page(date4, [r, keep], night); // back before it was delivered
    await w.plan(night);
    await w.deliver(new Date('2026-11-14T06:30:00Z'));
    const rows = await w.t.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.subscriptionId, a.subId));
    const cancelled = rows.find((x) => x.kind === 'cancelled');
    expect(cancelled?.status).toBe('suppressed');
    expect(cancelled?.lastError).toContain('withdrawn');
    expect(rows.some((x) => x.kind === 'reinstated')).toBe(false);
    expect(w.titles(a.token)).toHaveLength(1); // only the original notice was ever pushed
  });

  it('follows the "Izmena" toggle: switched off, it is recorded but not sent', async () => {
    const date5 = '15.11.2026.';
    const a = await w.addSub({ norm: 'kosmajska', kinds: ['new', 'cancelled'] });
    const r: [string, string, string] = ['Палилула - Ниш', '08:00 - 10:00', 'Космајске'];
    await w.page(date5, [r, keep]);
    await w.plan();
    await w.deliver();
    await w.page(date5, [keep]);
    await w.page(date5, [keep]);
    await w.plan();
    await w.deliver();
    await w.page(date5, [r, keep]);
    await w.plan();
    await w.deliver();
    expect(await w.kinds(a.subId)).toEqual([
      'new:sent:0',
      'cancelled:sent:1',
      'reinstated:suppressed:2',
    ]);
  });
});
