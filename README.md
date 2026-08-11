# 7S-rapport

Ett verktyg för att skriva **7S+1-rapport** (SoldF 2001) i telefonen — stund, ställe, styrka,
slag, sysselsättning, symbol, sagesman och sedan — och skicka den vidare som text eller PDF.

**Appen:** <https://steeriks.github.io/7s-rapport/>

Öppna länken i telefonen och välj *Lägg till på hemskärmen*. Då fungerar den utan täckning, vilket
är hela poängen: rapporten skrivs där man står.

## Vad den gör

- **Ny rapport** — ett fält per S, i rätt ordning. Stunden fylls i som tidsnummer (DDHHMI).
- **Ställe från GPS**, omräknat till det system du valt: MGRS, WGS84 DDM, SWEREF99 TM eller
  RT90 2,5 gon V. Omräkningen sker i appen, utan bibliotek och utan nät.
- **Sparade rapporter** ligger kvar i telefonen och kan öppnas igen.
- **Dela** som färdig textrapport att klistra in, som PDF, eller direkt till en förvald
  mottagaradress.

Allt lagras lokalt i webbläsaren. Ingen server, inget konto, ingenting skickas någonstans förrän
du själv delar rapporten — och därmed är det du som ansvarar för uppgifterna i den.

## Om koordinaterna

RT90-koordinaterna i SoldF 2001 innehåller ett fel på ungefär 200 m. Appens omräkning är verifierad
genom tur och retur (0,01 m), alltså mot matematiken — inte mot bokens tabellvärden. Räknar du för
hand efter boken och får något annat är det troligen boken som avviker.

## Utveckling

Inget byggsystem, inga beroenden att installera — statiska filer.

```bash
python3 -m http.server 8000     # och öppna http://localhost:8000
```

Varje ändring kräver att servicearbetarens cacheversion höjs i `sw.js`
(`'7s-rapport-vN'` → `'7s-rapport-v(N+1)'`), annars fortsätter installerade appar att servera den
gamla versionen. Läggs en ny fil till måste den även in i `ASSETS` i `sw.js`, annars saknas den
offline.

Push till `main` publicerar via GitHub Pages inom ungefär en minut.

Se [CLAUDE.md](CLAUDE.md) för filernas ansvar, koordinatimplementationerna och lagringsschemat.
