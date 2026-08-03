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

- **v15** (august 2026):
  - **Todoist virker igen.** Kun *hentning* af projekter fungerede; afsendelse
    fejlede med »tokenet virker ikke«. Årsagen var et fladt `Object.assign`,
    hvor POST-kaldets egne headers erstattede hele header-objektet og dermed
    fjernede `Authorization`. Tokenet var aldrig problemet.
  - **Quick view på madplanen.** Klik på en ret viser nu billede, kategori,
    tid, portioner og hele ingredienslisten – skaleret efter dagens antal
    personer – med knapper til Redigér, Til indkøbsliste og Åbn opskrift.
    Fritekst-linjer går som før direkte til redigering.
  - **Siden hopper ikke længere til toppen.** Gentegning scrollede altid op,
    og under en site-import sker det hvert 3. sekund – så man blev kastet op,
    uanset hvilken side man var på. Nu scroller kun reelle sideskift, og
    import-banneret opdateres alene i stedet for hele siden (så mister man
    heller ikke det, man skriver i søgefeltet).
  - Build-grænsen for install-scriptet hævet fra 110 K til 120 K tegn
    (systemgrænsen er ~131 K).

- **v12** (august 2026): **Indkøbslisten på mobil.** Opskriftsnavnet lå på samme
  linje som varen uden ombrydning og pressede varenavnet ned i en smal kolonne.
  Nu står opskriften under varen i lille skrift på små skærme, checkbokse og
  rækker er blevet større at ramme, og knapperne i toppen fylder mindre.
  Ny chip **»🏷️ Vis opskrift«** slår kolonnen helt fra (huskes) – rart, når man
  står i butikken. Vises kun under »Pr. afdeling«, hvor opskriften ikke i forvejen
  er overskrift.

- **v11** (august 2026): **Kategori-vælger til madplanens autofyld.** »Udfyld fra
  biblioteket« trak fra hele biblioteket, så saucer, smoothies og salater endte
  som aftensmad. Nu vælger man kategorier (med antal pr. kategori og genvejene
  »Markér alt« / »Kun hovedretter«); Hovedret er forvalgt, og valget huskes.
  AI-forslaget bruger samme filter, så de to knapper opfører sig ens.

- **v10** (august 2026): **Kategorier på importerede opskrifter.** Masse-importen
  satte dem aldrig (serveren kender ikke kategorilisten), og gætningen krævede,
  at sidens kategoritekst indeholdt ens eget kategorinavn – men sider bruger
  deres egne navne ("Aftensmad", "Bålmad", "Brød & Boller"). Nu gemmes sidens
  kategori råt, og Kokkeri kigger også på titlen: "Gullaschsuppe" → Suppe.
  Eksisterende opskrifter uden kategori udfyldes automatisk ved næste start
  (kun ét forsøg pr. opskrift, så et fravalg respekteres).
  Desuden **»Ryd data«** under Indstillinger (admin): vælg datatyper og skriv
  KOKKERI for at låse sletningen op – ordet tjekkes også server-side.
  Brugere og indstillinger bevares.

- **v9** (august 2026): Rettet de klikbare tider i fremgangsmåden. »1,5 time«
  blev læst som **5 timer**, fordi kun heltal blev genkendt. Nu forstås
  decimaler (1,5), brøker (1½), sammensatte tider (»1 time og 30 minutter«) og
  intervaller (»20-30 minutter« → den nedre, sikreste grænse), mens »5 tsk« og
  lignende ikke længere kan forveksles med en tid.

- **v8** (august 2026): **Masse-import fra et helt site.** Kokkeri finder
  opskrifterne via sitets sitemap (eller links på en oversigtsside) og henter
  dem som et **baggrundsjob på serveren** – browseren kan lukkes undervejs, og
  status vises som et banner på Opskrifter-siden. Sider uden opskrift springes
  automatisk over, dubletter ligeså. Offentlige sider (valdemarsro.dk,
  madbanditten.dk …) kræver ingenting; ligger opskrifterne bag et abonnement,
  indsættes ens egen session-cookie (eller en »Copy as cURL«), som **aldrig
  gemmes på disk**. Der ventes ~1,2 sek. mellem hver side. Billeder hentes
  bagefter ned lokalt, så biblioteket også virker offline.

- **v7** (august 2026): Hærdet efter den fælles rune-erfaringsfil:
  **cache-bust** (`?v=N` på app.js/style.css + `no-store` på HTML + versioneret
  service-worker-cache), så opdateringer slår igennem med det samme bag
  Cloudflare; **logo-upload gemmes som PNG**, så gennemsigtige logoer ikke
  bliver sorte; **print sætter PDF-filnavnet** (opskriftens titel + dato).

- **v6** (august 2026): **Egen AI-server** – under Indstillinger kan udbyderen
  nu skiftes fra Claude API til en OpenAI-kompatibel server på eget netværk
  (LM Studio, Ollama, llama.cpp …), så alle AI-funktioner kører lokalt og
  gratis. Angives ingen model, bruges den første på serveren; `<think>`-blokke
  fra ræsonnerende modeller (qwen3 m.fl.) filtreres fra.

- **v5** (august 2026): **Import fra indsat HTML/tekst** – til opskriftsider bag
  login (kopiér sidens kilde fra din egen indloggede browser og indsæt; Kokkeri
  parser HTML'en præcis som ved et link) og til opskrifter fra noter (indsæt
  ren tekst, AI'en strukturerer den). Findes som fold-ud-felt i
  import-dialogen og som handling i kommandopaletten.

- **v4** (august 2026): **Todoist**-integration – send indkøbslisten til et valgt
  Todoist-projekt med ét klik (butiksafdeling og opskrift følger med som note).
  Bruger Todoists unified API v1; det gamle `/rest/v2` blev pensioneret i 2026.
  Aktive **timere vises nu i kogetilstanden** som en stribe med live nedtælling;
  klik for at pause/fortsætte eller stoppe alarmen.

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
  **Home Assistant** og **Todoist**: send indkøbslisten videre med ét klik.
  **Enhedsomregning**: cups/oz/lbs/°F → dl/g/°C med én knap.

- **v2** (august 2026): Madplan kan auto-udfyldes fra biblioteket (uden AI) og
  retterne kan trækkes mellem dagene – ligger der allerede noget, bytter de
  plads. Aktive timere vises i venstremenuen med nedtælling. Timer-dialogen
  ligger nu foran kogetilstanden. Skærm-tændt-knappen viser tydeligt til/fra
  (📱 orange = tændt, 📴 grå = fra), og kogetilstanden har en klikbar indikator.
- **v1** (august 2026): Første udgave – opskrifter med URL-import
  (JSON-LD + microdata + AI-fallback), madplan med iCal-feed, indkøbsliste,
  timere, kogetilstand, skærmlås, AI-assistent, passkeys, backup.
