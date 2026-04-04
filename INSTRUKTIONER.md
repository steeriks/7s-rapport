# 7S Rapport – Instruktioner

## Snabbstart (5 minuter)

### Steg 1 – Publicera appen (gratis)

1. Skapa ett gratis konto på **https://netlify.com**
2. Logga in → dra och släpp hela mappen `7s-rapport` på Netlify-sidan
3. Du får en länk, t.ex. `https://dittnamn.netlify.app`
4. Dela länken med alla som ska använda appen

### Steg 2 – Lägg till på hemskärmen

**iPhone:**
1. Öppna länken i Safari (inte Chrome)
2. Tryck på dela-knappen (rutan med pil upp)
3. Välj "Lägg till på hemskärmen"
4. Nu finns appen som en ikon

**Android:**
1. Öppna länken i Chrome
2. Tryck på menyn (tre punkter uppe till höger)
3. Välj "Lägg till på startskärmen"

---

## Steg 3 – Konfigurera e-post (för att skicka till Stab/högre chef)

Enklaste sättet är att konfigurera **EmailJS** (gratis, 200 mejl/månad):

1. Gå till **https://emailjs.com** och skapa ett konto
2. Lägg till en e-posttjänst (t.ex. Gmail) – följ guiden på deras sida
3. Skapa en e-postmall med dessa fält:
   - `to_email` – mottagarens adress
   - `subject` – ämne
   - `message` – rapporttexten
   - `from_name` – avsändarens namn
4. Kopiera din **Public Key**, **Service ID** och **Template ID**
5. Öppna appen → Inställningar → fyll i dessa under "E-postkonfiguration"

**Alternativ (ingen konfiguration):** Om du inte ställer in EmailJS öppnas din vanliga e-postapp automatiskt med rapporten ifylld. Du trycker bara Skicka.

---

## Daglig sammanfattning

1. Öppna appen
2. Gå till fliken "Sparade"
3. Tryck "Skicka dagssammanfattning"

Appen laddar ner en PDF med alla dagens rapporter OCH skickar dem per e-post om EmailJS är konfigurerat.

---

## Rapportformat (för Signal)

Tryck "Kopiera till Signal" för att kopiera texten, öppna Signal och klistra in i gruppen.

Rapporten ser ut så här:
```
═══════════════════════════
       7S RAPPORT
═══════════════════════════
Stund:          2026-04-04 14:32
Ställe:         59.33456, 18.06490
Styrka:         3 personer
Slag:           Patrull
Sysselsättning: Rör sig mot norr längs väg E4
Symbol:         Grön uniform, inga märken
Sagesman:       Ditt Namn
═══════════════════════════
```

---

## Vanliga frågor

**Fungerar appen utan internet?**
Ja, efter första besöket sparas allt lokalt.

**Var sparas rapporterna?**
I telefonens webbläsarminne. De raderas inte om du stänger appen, men raderas om du rensar webbläsarens data.

**Kan flera personer använda appen?**
Ja – varje person öppnar appen på sin telefon och anger sitt eget namn under Inställningar.
