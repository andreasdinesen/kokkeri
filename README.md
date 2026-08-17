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

- **v26** (august 2026): **Claude kan nu læse og skrive i Kokkeri – og appen har
  fået sin egen »Opdatér«-knap i panelet.**
  - **Claude-adgang (MCP).** Under Indstillinger kan du forbinde **claude.ai**
    med adressen til din Kokkeri – du bliver sendt til appen for at godkende
    forbindelsen, præcis som med andre connectors. **Claude Code** og **Claude
    Desktop** bruger i stedet en nøgle, du laver samme sted. Claude kan søge i
    dine opskrifter, foreslå hvad du kan lave af det, du har hjemme, læse og
    lægge på madplanen, læse og tilføje til indkøbslisten samt oprette og rette
    opskrifter. En nøgle kan gives **kun læsning**, hvis den ikke skal kunne
    ændre noget, og du kan trække enhver forbindelse tilbage med det samme.
  - **»Opdatér Kokkeri«-knap** på serveren i panelet: skifter appens filer uden
    at geninstallere, og databasen røres ikke. Samtidig er Node-versionen blevet
    et felt i panelet, så den kan skiftes uden en ny udgave af appen.

- **v25** (august 2026): **Søgningen med ⌘K virker igen – og filtrene fylder
  ikke længere den halve skærm.**
  - **Opskrifter fundet med ⌘K kunne ikke vælges.** Listen blev tegnet helt om,
    hver gang musen kørte hen over et resultat, så elementet blev skiftet ud
    midt i klikket – og et klik, der begynder på ét element og slutter på et
    andet, tæller ikke. På en telefon eller tablet skete det hver gang, så dér
    har det aldrig virket. Nu flyttes kun markeringen.
  - **Filtrene ligger i et foldeligt panel.** Søgefeltet står stadig frit, mens
    sortering, vurdering, kilde, favoritter og kategorier er samlet ét sted.
    Den sammenfoldede linje viser, hvilke filtre der er slået til, så man ikke
    kan komme til at lede efter opskrifter, der er filtreret væk. Panelet
    starter åbent på en computer og lukket på en telefon – og husker dit valg.
  - **Nyt kildefilter:** vis kun opskrifter fra ét site, fx `valdemarsro.dk`.
    Vælgeren viser antallet fra hvert site og kan kombineres med søgning,
    kategori og stjerner.

- **v24** (august 2026): **En stoppet masse-import forsvinder ikke længere
  sporløst.** Afviser et site hentningen, stopper Kokkeri – men indtil nu blev
  statusfeltet kun vist, mens en import kørte, så beskeden om hvorfor forsvandt
  i samme øjeblik. Man fik »Importen er startet« og hørte aldrig mere.
  - Et stoppet job med en fejl vises nu som en tydelig besked med, hvor langt
    den nåede, og en OK-knap. Beskeden overlever en genindlæsning.
  - Teksten skelner nu mellem, at **din adgang** ikke virker længere, og at
    **sitet blokerer for automatisk hentning** – før stod der »cookien virker
    ikke«, også når man aldrig havde brugt en.
  - **Én afvist side stopper ikke længere hele importen.** Der skal tre
    afvisninger i træk til, så en enkelt beskyttet side ikke kan dræbe en
    import af tusindvis af opskrifter.

- **v23** (august 2026): **Overblik over de sites, du har hentet fra.** Øverst i
  masse-import-vinduet står nu hvert site med antal opskrifter og datoen for
  seneste hentning – og en **»Hent nye«**-knap, der starter søgningen med det
  samme. Sider, du allerede har hentet, springes over, så knappen henter kun
  det, der er kommet til siden sidst.
  - Metode og mønster **huskes pr. site**, så »Hent nye« rammer rigtigt – uden
    det skulle man selv huske, at fx arla.dk kræver mønsteret `/opskrifter/`.
    Mønsteret vises som en lille undertekst på linjen.
  - Listen udledes af opskrifternes egen kilde-adresse i stedet for en separat
    historik. Så viser den altid, hvad der faktisk ligger i biblioteket – også
    efter en oprydning eller en gendannet backup.

- **v22** (august 2026): **»Hvad kan jeg lave?« – find opskrifter ud fra de
  råvarer, du har.** Nyt panel på Opskrifter: vælg fx *Kylling* og *Svampe*, og
  de opskrifter der har begge, lægger sig øverst – resten følger efter, sorteret
  efter hvor mange af dine råvarer de rammer. En linje fortæller løbende, hvor
  mange der har dem alle, og hvor mange der har mindst én.
  - Råvarerne vises med antal fra **dit eget bibliotek**, så listen følger med,
    når det vokser, og tomme grupper skjules. Kød og fisk står først, derefter
    grønt og kulhydrater, og basisvarer til sidst – man vælger sjældent
    aftensmad ud fra, at man har mælk.
  - Fritekstfeltet dækker alt det, der ikke har sin egen knap – fx *porrer*.
  - Retter hvor råvaren kun optræder som **smagsgiver** tælles ikke med: en ret
    med en terning kyllingebouillon er ikke en kyllingeret.
  - Opslaget sker i dine egne opskrifter – ingen AI-nøgle, ingen ventetid, og
    tallene passer.

- **v21** (august 2026): **Masse-import virker nu på sites som arla.dk.**
  Nogle sites deler deres sitemap op i flere dele og giver delene adresser som
  `sitemap.xml?type=…`. Kokkeri afgjorde på filnavnet, om der var tale om et
  under-sitemap, og en adresse med `?` bagefter faldt igennem – så en søgning på
  arla.dk gav **nul** sider, selvom sitet har over 3.000 opskrifter liggende.
  Nu afgøres det på indholdet, som sitemap-standarden foreskriver.
  Samtidig blev det interne loft for fundne adresser hævet fra 3.000 til 20.000
  (arlas opskrifter ligger sidst og var tæt på at blive sprunget over i stilhed),
  og filtreringen af filer ser nu kun på selve stien, så en opskrift med fx
  `?ref=billede.jpg` i adressen ikke bliver sorteret fra.
  **Bemærk:** på arla.dk ligger der ca. 1.400 inspirations- og oversigtssider
  under samme `/opskrifter/`-adresse. De tælles som "fejlet" undervejs – det er
  meningen; de indeholder ingen opskrift.

- **v20** (august 2026): **Bedre på telefon og tablet.**
  - **iPad i portræt fik hele bredden.** Grænsen for, hvornår sidebaren bliver
    til en skjult menu, er hævet fra 760 til 900 px – før åd sidebaren 216 px
    af en i forvejen smal skærm på en iPad i højformat.
  - **Menuknappen lå oven i sidens overskrift** på telefon. Toppen har nu plads
    til den.
  - **Overblik**: nøgletallene står to og to i stedet for én kolonne pr. tal,
    mindre overskrifter, og under »De næste dage« får retten sin egen linje i
    stedet for at blive klemt sammen ved siden af dag og dato.
  - **Opskrifter**: kortene står to og to på en telefon i stedet for ét pr.
    skærm, søgefeltet fylder bredden, og sortering + stjernefilter deler en
    række.
  - **Menuen lukkes nu ved at trykke ved siden af den** – før skulle man ramme
    den lille knap igen.
  - Lange ubrudte ord (importerede titler, kilde-URL'er) brækker nu i stedet
    for at skubbe siden bredere, og på skærme under 900 px kan siden ikke
    længere scrolles sidelæns.

- **v19** (august 2026): **Biblioteket kan nu bære tusindvis af opskrifter – og
  du kan give stjerner direkte fra oversigten.**
  - **Login gik fra 248 MB til 1,3 MB.** Kokkeri hentede hele biblioteket med
    billeder og alt, hver gang du loggede ind. Nu ligger fotoet for sig selv og
    hentes kun til de opskriftskort, du faktisk ser – og browseren kan gemme det
    i sin cache. Serveren gik fra 3,7 GB hukommelse til under 150 MB.
    Ved første opstart flyttes de eksisterende billeder automatisk (tager et
    sekund eller to); du skal ikke gøre noget.
  - **Oversigten tegner 60 kort ad gangen** med en »Vis flere«-knap, der også
    henter automatisk, når du ruller ned. Søgningen var før nødt til at bygge
    hele biblioteket forfra ved hvert tastetryk.
  - **Stjerner på kortene**: klik direkte i oversigten uden at åbne opskriften
    (klik på samme stjerne igen fjerner vurderingen). Ny **sortering** – flest
    eller færrest stjerner, titel, korteste tid – og et filter, der kun viser
    opskrifter med mindst så og så mange stjerner. Valgene huskes.
  - **Madplanen kan kræve stjerner**: både »Udfyld fra biblioteket« og
    AI-forslaget kan nu bede om fx mindst 4 stjerner, så hverdagene fyldes med
    retter, du allerede ved er gode. Vælgeren viser løbende, hvor mange
    opskrifter der er tilbage at vælge imellem.
  - **Gendannelse af en stor backup virker igen.** En backup med billeder er
    flere hundrede megabyte og blev afvist af serveren; den sendes nu i
    portioner. Backup og database-download bygges ikke længere i hukommelsen.
  - Kalender-feedet og delings-links slår nu kun de opskrifter op, de skal
    bruge, i stedet for at læse hele biblioteket ved hvert opslag.

- **v18** (august 2026): **Installationen fylder en fjerdedel mindre.** Hele appen
  ligger inde i runens install-script, og Linux sætter en hård grænse for, hvor
  langt det må være – den var ved at være nået. App-filerne trimmes nu for
  kommentarer og indrykning, inden de pakkes (kilderne i repoet er urørte), og
  pakningen er skiftet fra gzip+base64 til brotli+base85. Tilsammen: install-
  scriptet gik fra 113.959 til 84.779 tegn, uden at en eneste linje app-kode blev
  ændret. Ingen synlige ændringer i appen – kun plads til at vokse videre.

- **v17** (august 2026):
  - **AI-svar fra lokale modeller kunne ikke læses.** Svaret blev klippet ud fra
    første `[` til sidste `]` – men lokale modeller (LM Studio/Ollama) skriver
    typisk en forklaring udenom, fx »Her er en madplan [baseret på dine
    opskrifter]:«, så klipningen ramte den forkerte parentes. Nu findes den
    første **komplette** JSON-struktur, med flere startpunkter som reserve.
    Klarer markdown-hegn, `<think>`-blokke, `{"plan": [...]}`-indpakning og et
    efterladt komma. Fejlbeskeden viser nu også, hvad modellen faktisk svarede.
    Rettet alle fem steder (madplan, ernæring, opskrift-udtræk, indkøbssortering
    og AI-import på serveren).
  - **Opskrifter uden kategori** kan nu findes med en egen chip, der viser
    antallet. I den visning har hvert kort en kategori-vælger, så det er ét klik
    pr. opskrift i stedet for at åbne og gemme hver enkelt.
  - **Ryd ugens madplan**: ny rød knap, der først viser dag for dag hvad der
    fjernes, og kræver et flueben før knappen låser op. Opskrifterne selv røres
    ikke – kun planlægningen.
  - **Billeder i madplanen** kan slås til og fra med en knap; valget huskes.

- **v16** (august 2026): **Store sites kan hentes helt.** Søgningen sendte kun de
  første 1000 fundne sider videre, så resten var uden for rækkevidde (madbanditten
  har 3169). Loftet er hævet til 5000. Samtidig **husker Kokkeri nu hver side, den
  har hentet** – også dem uden opskrift, som fylder mest i et sitemap. Søger man
  igen på samme site, står der fx »3169 sider · 3166 nye (3 hentet før, springes
  over)«, og importen fortsætter, hvor den slap, i stedet for at bruge køretiden
  om igen. Hukommelsen kan ryddes under Indstillinger → Ryd data → »Hentede sider«.

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
