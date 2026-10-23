# Report: Phase 3, step 6 follow-up (PM notes), 23 Oct 2026

Stopped. Step 7 is **not** started (the PM note says to go ahead once the push is settled; it is not).

## Commits

| Commit                                         | What                                                                 | On GitHub |
| ---------------------------------------------- | -------------------------------------------------------------------- | --------- |
| `e030de4`                                      | "Prati" cursor in the house number; Istorija hides deleted addresses | **no**    |
| (this report, committed right after `e030de4`) | `docs/reports/` files                                                | **no**    |
| `e055a9a`                                      | Report for step 6                                                    | **no**    |
| `dbe9830`                                      | Step 5 review fixes and step 6 (Najave, Istorija)                    | **no**    |

`origin/main` is at `a4c826f`. **Not pushed, and not pushed on purpose:** the PM note says "wait for Milan's OK" for `dbe9830` and `e055a9a` (the PM has not seen the diff), and approvals come only from the owner. Four commits are waiting.

## Checks (all green)

- `pnpm lint`: zero warnings. `pnpm typecheck`: 5 of 5.
- `pnpm test`: shared 22, parser 144 (+3 todo), scripts 62, server 227, **mobile 238 jest + 20 contract** (was 234 + 20).

## Done (from the PM note)

- **"Prati" keeps opening the Add address sheet.** The street is chosen, the **cursor is in the house number field** (the keyboard opens on it), and a line under the field says what saving means: "Sa brojem javljamo samo kada isključenje pogađa vaš broj. Bez broja javljamo za celu ulicu." Saving without a number stays possible. A street picked by searching does not take the cursor.
- **Istorija hides the outages of a deleted address** and does not count them in the year tiles ("Obrisana adresa" is gone). The data is not deleted: it stays in the saved copy and on the server.
- Screenshots of the follow sheet and the lists retaken: `docs/screens/android/step6/`.

## To know

- "The history comes back if the same address is added again" holds on the device, but on the server a new address gets a **new id**, and the history is kept per address id. For the old outages to show again, the server must connect them by street and number. That is the server's decision (Phase 2 code), not the app's; tell me if you want me to look at it.

## Decisions needed

1. **Push** `dbe9830`, `e055a9a`, `e030de4` and the report commits? (Needs the owner's OK.)
2. Then **step 7, Podešavanja**.
