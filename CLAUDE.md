# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Progressive Web App (PWA) for Swedish military incident reporting using the 7S+1 format (SoldF 2001). No build system, no dependencies, no server — static files served directly from GitHub Pages at `https://steeriks.github.io/7s-rapport/`.

## Deploying changes

Every change requires bumping the service worker cache version so devices pick up the new files:

1. Increment the cache name in `sw.js`: `'7s-rapport-vN'` → `'7s-rapport-v(N+1)'`
2. Commit and push — GitHub Pages deploys automatically within ~1 minute
3. Users must close and reopen the app in Safari/Chrome to load the new version

## Architecture

Single-page app with three tabs (Ny Rapport / Sparade / Inställningar). All state lives in `localStorage`. No backend.

**File responsibilities:**
- `app.js` — all logic: coordinate conversion, form handling, PDF generation (jsPDF via CDN), report storage, mailto: email, service worker registration
- `index.html` — markup only; one CDN script (jsPDF)
- `style.css` — mobile-first CSS; CSS variables for the military green/tan palette
- `sw.js` — cache-first service worker; lists assets to precache in `ASSETS`
- `manifest.json` — PWA manifest (name, icons, theme colour)

## Coordinate conversion

All conversions are implemented natively in `app.js` — no external libraries. The GPS always returns WGS84 decimal; `convertCoords(lat, lon, system)` converts to the selected system:

| System | Implementation |
|--------|---------------|
| MGRS | `_toMGRS()` — UTM via `_tm()` then 100km grid square lookup |
| WGS84 DDM | `_toDDM()` — simple arithmetic |
| SWEREF99 TM | `_toSWEREF99()` — TM projection on WGS84, central meridian 15°, zone 33 |
| RT90 2.5 gon V | `_toRT90()` — 7-parameter Helmert (WGS84→Bessel) + Gauss-Krüger |

The helper `_tm(latDeg, lonDeg, ell, lon0Deg, k0, FE, FN)` is the shared Transverse Mercator implementation used by MGRS, SWEREF99, and RT90.

**Note:** The RT90 coordinates in SoldF 2001 contain a ~200m error. The implementation is verified correct by round-trip (0.01 m), not by the book's reference values.

## Report format

`reportToText(r)` produces the plain-text Signal/clipboard format. Stund is always formatted as tidsnummer (DDHHMI, e.g. `042115`). Ställe includes a coordinate system prefix for non-WGS84 systems (e.g. `[MGRS] 34VCL...`). Field 8 (Sedan) is omitted from output when empty.

## Storage schema

```js
localStorage['settings'] = { sagesman, centralEmail, dailyTime }
localStorage['reports']  = [ { id, stund, stalle, stalleSystem, styrka, slag,
                                sysselsattning, symbol, sagesman, sedan, created } ]
```

## Adding a new asset

If a new file is added (e.g. a second JS file), it must be added to the `ASSETS` array in `sw.js` or it won't be cached for offline use.
