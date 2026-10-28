# Map zoom: the person's house, else their street, with "Celo isključenje"

Date: 2026-10-28. Branch `main`. One commit after `4cdb935` (the street labels and the partial-name rule), **not pushed**.

## What it does

The map on the outage detail no longer starts on the whole outage (which, for an outage that spans a wide area, made the streets small):

1. **The address has a house number OSM knows** (the lime marker): the view starts on the house, about 400 m across (zoom about 16.5).
2. **Otherwise**: on the person's street, the part of the outage that is theirs (the street's geometry among the outage's features; the candidates of an ambiguous name do not count).
3. **The person has no address in the outage**: the whole outage, as before.

A pill on the map, top left, goes to **"Celo isključenje"** (the whole outage, with a short animation) and back to **"Moja adresa"**. It appears only when the focus is clearly smaller than the whole outage (the whole must be at least 1.4 times larger by area); an outage of one small street has no button. It is a real button for TalkBack (a label of its own, a 48 dp touch area with the hit slop); the map itself stays hidden from the screen reader, the street list is its accessible version.

How: each saved address now carries its street id into the map (`DetailAddress.streetId`); the map picks the features of those streets (`featuresOfStreets`), measures the boxes (`boxArea`) and drives the camera with `fitBounds`. Strings in three scripts: `detail.mapWhole`, `detail.mapMine`.

## Checked

Emulator against the real local server, Trebinjska 34 saved: the map opens on the house with the street names around it, the pill says "Celo isključenje"; pressing it shows the whole outage and the pill says "Moja adresa" (screenshots `docs/screens/android/step10b/12-zoom-house.png`, `13-zoom-whole.png`; the working set is git-ignored).

Tests (4 new in `map.test.tsx`, which now also stubs the camera): starts on the house (about 0.004 degrees across, centred on it) and the button goes to the whole outage and back; without a number it starts on the street of the address and ignores a candidate of another name; no address in the outage shows the whole outage and no button; a single small street has no button. The mock API's geometry now uses the mock gazetteer's street ids.

## Gate

Mobile: lint 0 warnings, typecheck green, **328** jest tests green; the full-repo gate is run again at the end of step 11.

## Decisions

None. (The phone session is not started: it comes after the emulator part of step 11.)
