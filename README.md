# Kokkeri 🍳

Dit eget lokale opskrifts-bibliotek – et selvhostet alternativ til Paprika 3,
bygget som **rune** til [Yggdrasil Panel](https://yggdrasilpanel.com).
Én YAML-fil installerer hele appen i en container: Node.js-server + webapp +
SQLite. **Ingen npm-afhængigheder, ingen CDN – alt kører lokalt.**

## Funktioner

- **Opskrifter**: bibliotek med billeder, kategorier, tags, favoritter og
  1-5-stjerners vurdering. Søgning i titel, ingredienser og tags.
- **Import fra URL**: indsæt et link til en opskrift (Valdemarsro, Arla,
  Madens Verden m.fl.) – Kokkeri læser selv siden (schema.org/Recipe som
  JSON-LD *og* microdata), trækker titel, ingredienser, fremgangsmåde, tider og
  billede ud og gemmer kilde-linket, så du altid kan gå tilbage til originalen.
  Billeder skaleres og gemmes lokalt i databasen.
- **AI-fallback ved import**: har siden ingen maskinlæsbare data, kan AI'en
  læse sideteksten og bygge opskriften (kræver Claude API-nøgle).
- **Portions-skalering**: skru op/ned for portioner – mængderne regnes om
  (forstår 1,5 · 1½ · ¾ · "2-3").
- **Kogetilstand**: fuldskærm, ét trin ad gangen med stor skrift,
  piletaster/knapper, ingredienser i sidepanelet – og skærmen holdes tændt.
- **Madplan**: uge-visning med opskrifter eller fritekst pr. dag,
  print, og iCal-abonnement så madplanen vises i Apple/Google Kalender.
  AI'en kan foreslå en hel uges madplan ud fra dine egne opskrifter.
- **Indkøbsliste**: tilføj en hel opskrift (skaleret) eller hele ugens madplan
  med ét klik, grupperet pr. opskrift, afkrydsning, print.
- **Timere**: flere navngivne køkkentimere med forvalg, pause og +1 min – de
  overlever sideskift og genindlæsning, ringer med lyd og notifikation.
  Klik på et minuttal inde i en fremgangsmåde for at starte en timer direkte.
- **Hold skærmen tændt**: global til/fra-knap (Wake Lock API, kræver https) –
  slås automatisk til i kogetilstand.
- **AI-assistent**: chat med en køkkenassistent, der kender dine opskrifter og
  din madplan – idéer, ingrediens-erstatninger, teknik. Assistentens
  opskrift-forslag kan gemmes i biblioteket med ét klik. Claude API-nøglen
  gemmes kun på serveren og sendes aldrig til browseren.
- **Kommandopalet**: `Cmd/Ctrl+K` – hop til sider, opskrifter og handlinger.
- Flere brugere med kodeord + **passkeys** (WebAuthn), admin-brugerstyring,
  mørkt/lyst tema, logo-upload, backup/gendan (JSON + rå .db).

## Installation (Yggdrasil Panel)

1. Upload `runes/kokkeri.yaml` som en ny rune i panelet.
2. Opret en server på runen og start den – første bruger, der registrerer sig,
   bliver administrator.

## AI-funktionerne (valgfrit)

Opret en API-nøgle på [console.anthropic.com](https://console.anthropic.com) og
indsæt den under **Indstillinger → AI-assistent**. Uden nøgle virker alt andet
som normalt; AI-import, madplan-forslag og assistenten kræver den.

## Kør lokalt (udvikling)

```sh
# Kør serveren (Node >= 22):
mkdir -p /tmp/kkdata && BIND_PORT=8902 DATA_DIR=/tmp/kkdata node app/server.js

# Genbyg app.js + rune efter ændringer i app/parts/ (kræver PyYAML):
python3 build_rune.py
```

Frontenden er delt op i `app/parts/p*.js`, som `build_rune.py` samler til
`app/public/app.js` og pakker ind i `runes/kokkeri.yaml` – redigér aldrig de to
genererede filer direkte.

## Versionshistorik

- **v3** (august 2026): **Paprika-import** (hele biblioteket fra en
  .paprikarecipes-eksport inkl. billeder, tider, kategorier og vurderinger).
  **Smart indkøbsliste**: ens varer lægges sammen, varerne grupperes pr.
  butiksafdeling (regelbaseret + AI for resten), og et **forråd** holder
  basisvarer ude af listen (med udløbsdatoer). **Madplan-skabeloner** (gem en
  uge, læg den ind i enhver anden uge) og **måltids-typer**
  (morgenmad/frokost/aftensmad/andet). Kogetilstand: **kryds ingredienser af**
  undervejs. **Ernærings-estimat** pr. portion via AI. **Offline-støtte**
  (service worker – appen og senest sete opskrifter virker uden net).
  **Del en opskrift** med et offentligt link (kan slås fra igen).
  **Home Assistant**: send indkøbslisten til en todo-liste med ét klik.
  **Enhedsomregning**: cups/oz/lbs/°F → dl/g/°C med én knap.

- **v2** (august 2026): Madplan kan auto-udfyldes fra biblioteket (uden AI) og
  retterne kan trækkes mellem dagene – ligger der allerede noget, bytter de
  plads. Aktive timere vises i venstremenuen med nedtælling. Timer-dialogen
  ligger nu foran kogetilstanden. Skærm-tændt-knappen viser tydeligt til/fra
  (📱 orange = tændt, 📴 grå = fra), og kogetilstanden har en klikbar indikator.
- **v1** (august 2026): Første udgave – opskrifter med URL-import
  (JSON-LD + microdata + AI-fallback), madplan med iCal-feed, indkøbsliste,
  timere, kogetilstand, skærmlås, AI-assistent, passkeys, backup.
