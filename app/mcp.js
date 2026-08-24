'use strict';
/*
 * Kokkeri - MCP-server (Model Context Protocol).
 *
 * Streamable HTTP + JSON-RPC 2.0, haandskrevet. MCP ER bare JSON-RPC over HTTP,
 * saa der er ingen grund til en pakke - og dermed ingen forsyningskaede at
 * holde patchet. Porteret fra doda, se RUNE-ERFARINGER §9a.
 *
 * Vaerktoejerne skriver gennem srv.gemItem, som er PRAECIS den vej webappen
 * bruger (sanitizeItem + upsertItem). Der findes ingen saerlig MCP-indgang til
 * dataene - saa en ny klient er samtidig en gratis integrationstest.
 */

const PROTOKOL = '2025-06-18';
const PROTOKOLLER = ['2025-06-18', '2025-03-26', '2024-11-05'];

/* Ord der betyder, at raavaren kun er smagsgiver. Holdes i sync med
 * SMAGSORD i app/parts/p1b_food.js - en ret med en terning kyllingebouillon
 * er ikke en kyllingeret. */
const SMAGSORD = /(bouillon|fond|suppeterning|krydderi|essens|aroma|ekstrakt)/;

/* Raavaregrupperne fra app/parts/p1b_food.js. Bevidst duplikeret - frontenden
 * og serveren er to miljoeer uden faelles modul - men HOLD DEM I SYNC, samme
 * aftale som parseAiJson/parseAiJsonServer. Uden dem ville "svampe" ikke finde
 * en opskrift, der siger "champignon", og MCP-vaerktoejet ville svare daarligere
 * end appen selv. */
const RAAVARE_GRUPPER = [
  ['kylling', /kylling|unghane|hønse|hane\b/],
  ['hakket kød', /hakket (okse|svine|kalve|lamme|kyllinge|kalkun)?kød|hakkekød|hakket (okse|svin|kalv|lam)|\bfars\b|oksefars|svinefars|kødfars/],
  ['oksekød', /oksekød|okseinderlår|culotte|entrecote|ribeye|bøf(?!fel)|okseklump|tyndstegsfilet|højreb/],
  ['svinekød', /svinekød|flæsk|nakkefilet|svinemørbrad|kotelet|bacon|skinke|pancetta/],
  ['lam', /lammekød|lammekølle|lammefilet|lammekotelet|\blam\b/],
  ['kalkun', /kalkun/],
  ['fisk', /laks|torsk|rødspætte|makrel|tun\b|sej\b|kulmule|hellefisk|fiskefilet|\bfisk\b/],
  ['skaldyr', /rejer|muslinger|krebse|hummer|blæksprutte|jomfruhummer/],
  ['æg', /(^| )æg( |$)|æggeblomme|æggehvide/],   // ikke \\bæg\\b - se p1b_food.js
  ['pasta', /pasta|spaghetti|penne|tagliatelle|lasagne|makaroni|fusilli|orzo/],
  ['ris', /\bris\b|risotto|jasminris|basmati|grødris/],
  ['kartofler', /kartof/],
  ['bønner', /kikærter|linser|kidneybønner|sorte bønner|hvide bønner|bønner/],
  ['svampe', /champignon|svampe|portobello|karljohan|shiitake/],
  ['kål', /broccoli|blomkål|spidskål|hvidkål|rødkål|grønkål|rosenkål/],
  ['tomater', /tomat/],
  ['squash', /squash|zucchini|aubergine/],
  ['spinat', /spinat/],
  ['ost', /\bost\b|mozzarella|feta|parmesan|cheddar|flødeost/],
  ['mælk', /piskefløde|madlagningsfløde|\bfløde\b|\bmælk\b|kærnemælk|creme fraiche|cremefraiche/]
];
/* Frokost-genkendelse - samme regex som erFrokost() i app/parts/p1b_food.js.
 * Kokkeri har ingen Frokost-KATEGORI (en opskrift kan kun have én), men ordet
 * staar i sidens egen kategori og i tags paa tusindvis af opskrifter.
 * HOLD DEN I SYNC med frontenden, samme aftale som RAAVARE_GRUPPER. */
const FROKOST_RE = /frokost|madpakke|madkasse|brunch|smørrebrød|sandwich|\bwrap\b|panini|\bpita\b|toast|croque|æggekage|omelet|frittata|tapas|\bbowl\b|quiche|let ret|letret|mellemmåltid/;

const norm = s => String(s || '').toLowerCase().replace(/[^a-zæøå0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function opret(srv) {
  /* ------------------------------------------------------------ hjaelpere */

  const opskrifter = () => srv.listItems('recipe');
  const kort = r => ({
    id: r.id, title: r.title, category: r.category || null,
    rating: r.rating || 0, minutes: srv.totalMin(r), source: srv.host(r) || null,
    servings: r.servings || null
  });
  const fuld = r => Object.assign(kort(r), {
    description: r.description || '', ingredients: r.ingredients || [],
    instructions: r.instructions || [], notes: r.notes || '',
    url: r.url || '', tags: r.tags || [], favorite: !!r.favorite,
    timesCooked: r.timesCooked || 0, lastCooked: r.lastCooked || null
  });
  const erFrokost = r => FROKOST_RE.test(norm([r.sourceCategory || '', (r.tags || []).join(' '), r.title || ''].join(' ')));
  const linjer = r => (r.ingredients || []).filter(l => !/^##/.test(l)).map(norm);
  /* Findes der en gruppe for ordet, bruges dens regex ("svampe" skal ogsaa
   * finde champignon). Ellers delstreng - ikke praefiks, for paa dansk staar
   * hovedordet tit sidst i et sammensat ord ("koed" i oksekoed, hakkekoed). */
  const raavareRe = ord => {
    const g = RAAVARE_GRUPPER.find(([navn, re]) => navn === ord || navn.includes(ord) || re.test(ord));
    return g ? g[1] : null;
  };
  const harRaavare = (r, ord) => {
    const re = raavareRe(ord);
    const t = linjer(r).filter(l => (re ? re.test(l) : l.includes(ord)));
    return t.length > 0 && !t.every(l => SMAGSORD.test(l));
  };
  const dato = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null;
  const tekstliste = (titel, raekker) =>
    raekker.length ? `${titel}\n` + raekker.join('\n') : `${titel}\n(ingen)`;

  /* ---------------------------------------------------------- vaerktoejer */

  const VAERKTOEJER = [
    {
      name: 'search_recipes',
      scope: 'read',
      description: 'Search the user\'s own recipe library by free text (matches title, tags and '
        + 'ingredients). Optionally narrow by category, source site or minimum star rating. '
        + 'Returns ids - always read an id from here before calling get_recipe.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free text. Leave empty to list everything.' },
          category: { type: 'string' },
          source: { type: 'string', description: 'Base domain, e.g. valdemarsro.dk' },
          min_rating: { type: 'number', description: '0-5' },
          meal: { type: 'string', description: 'Set to "lunch" to only get recipes suited for lunch '
            + '(lunch, packed lunch, sandwiches, brunch, light dishes). The library has no lunch '
            + 'category - this matches how the source sites tagged them.' },
          limit: { type: 'number', description: 'Default 20, max 100.' }
        }
      },
      kald(a) {
        const q = norm(a.query);
        const grænse = Math.min(100, Math.max(1, +a.limit || 20));
        let liste = opskrifter();
        if (a.category) liste = liste.filter(r => norm(r.category) === norm(a.category));
        if (a.source) liste = liste.filter(r => srv.host(r) === String(a.source).replace(/^www\./, ''));
        if (a.min_rating) liste = liste.filter(r => (r.rating || 0) >= +a.min_rating);
        if (/lunch|frokost/i.test(String(a.meal || ''))) liste = liste.filter(erFrokost);
        if (q) {
          liste = liste.filter(r => norm(r.title).includes(q)
            || norm((r.tags || []).join(' ')).includes(q)
            || norm((r.ingredients || []).join(' ')).includes(q));
        }
        const valgt = liste.slice(0, grænse).map(kort);
        return {
          tekst: tekstliste(`${liste.length} ${liste.length === 1 ? 'opskrift matcher' : 'opskrifter matcher'} (viser ${valgt.length}):`,
            valgt.map(r => `- ${r.title} [${r.id}]${r.category ? ' · ' + r.category : ''}`
              + `${r.rating ? ' · ' + '★'.repeat(r.rating) : ''}${r.minutes ? ' · ' + r.minutes + ' min' : ''}`)),
          data: { total: liste.length, recipes: valgt }
        };
      }
    },
    {
      name: 'get_recipe',
      scope: 'read',
      description: 'Read one full recipe: ingredients, steps, notes and source. Use an id from search_recipes.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      kald(a) {
        const r = srv.getItem(String(a.id || ''));
        if (!r || r.kind !== 'recipe') return { fejl: 'Ingen opskrift med det id. Brug search_recipes først.' };
        const d = fuld(r);
        return {
          tekst: `${d.title}\n${d.category || ''}${d.minutes ? ' · ' + d.minutes + ' min' : ''}`
            + `${d.servings ? ' · ' + d.servings + ' portioner' : ''}\n\n`
            + `Ingredienser:\n${(d.ingredients || []).map(l => '- ' + l).join('\n')}\n\n`
            + `Fremgangsmåde:\n${(d.instructions || []).map((l, i) => `${i + 1}. ${l}`).join('\n')}`
            + (d.notes ? `\n\nNoter:\n${d.notes}` : '') + (d.url ? `\n\nKilde: ${d.url}` : ''),
          data: d
        };
      }
    },
    {
      name: 'what_can_i_cook',
      scope: 'read',
      description: 'Find recipes that use the ingredients the user has at home. Give the plain '
        + 'Danish word for each ingredient (e.g. "kylling", "svampe", "hakket kød"). Recipes that '
        + 'match the most ingredients come first. Ingredients that only appear as stock or '
        + 'seasoning do not count.',
      inputSchema: {
        type: 'object',
        properties: {
          ingredients: { type: 'array', items: { type: 'string' }, description: 'One or more ingredients.' },
          meal: { type: 'string', description: 'Set to "lunch" to only suggest lunch-friendly recipes.' },
          limit: { type: 'number', description: 'Default 15.' }
        },
        required: ['ingredients']
      },
      kald(a) {
        /* To bogstaver er nok, HVIS ordet er en kendt raavaregruppe - "æg",
         * "ost" og "ris" er rigtige danske raavarer. Ellers kraeves tre, saa et
         * tilfaeldigt "af" ikke matcher det halve bibliotek. */
        const ord = (Array.isArray(a.ingredients) ? a.ingredients : []).map(norm)
          .filter(x => x.length >= 3 || (x.length >= 2 && RAAVARE_GRUPPER.some(([navn]) => navn === x)));
        if (!ord.length) return { fejl: 'Angiv mindst én råvare (mindst to bogstaver for kendte råvarer som æg, ost og ris).' };
        const grænse = Math.min(50, Math.max(1, +a.limit || 15));
        const scoret = [];
        const kunFrokost = /lunch|frokost/i.test(String(a.meal || ''));
        for (const r of opskrifter()) {
          if (kunFrokost && !erFrokost(r)) continue;
          const n = ord.filter(o => harRaavare(r, o)).length;
          if (n) scoret.push({ n, r });
        }
        scoret.sort((x, y) => y.n - x.n || (y.r.rating || 0) - (x.r.rating || 0));
        const valgt = scoret.slice(0, grænse);
        const alle = scoret.filter(x => x.n === ord.length).length;
        return {
          tekst: tekstliste(`${alle} ${alle === 1 ? 'opskrift har' : 'opskrifter har'} alle ${ord.length}, ${scoret.length} har mindst én:`,
            valgt.map(x => `- ${x.r.title} [${x.r.id}] · ${x.n}/${ord.length} råvarer`)),
          data: { with_all: alle, with_any: scoret.length, recipes: valgt.map(x => Object.assign(kort(x.r), { matched: x.n })) }
        };
      }
    },
    {
      name: 'get_meal_plan',
      scope: 'read',
      description: 'Read the meal plan between two dates (YYYY-MM-DD, inclusive).',
      inputSchema: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to']
      },
      kald(a) {
        const fra = dato(a.from), til = dato(a.to);
        if (!fra || !til) return { fejl: 'Datoer skal skrives som YYYY-MM-DD.' };
        const navne = new Map(opskrifter().map(r => [r.id, r.title]));
        const poster = srv.listItems('planEntry')
          .filter(e => e.date >= fra && e.date <= til)
          .sort((x, y) => String(x.date).localeCompare(String(y.date)));
        return {
          tekst: tekstliste(`Madplan ${fra} – ${til}:`, poster.map(e =>
            `- ${e.date} ${e.slot || 'dinner'}: ${e.recipeId ? (navne.get(e.recipeId) || '(slettet opskrift)') : (e.text || '')}`
            + (e.recipeId ? ` [${e.recipeId}]` : ''))),
          data: {
            entries: poster.map(e => ({
              id: e.id, date: e.date, slot: e.slot || 'dinner',
              recipe_id: e.recipeId || null, title: e.recipeId ? (navne.get(e.recipeId) || null) : (e.text || null),
              servings: e.servings || null
            }))
          }
        };
      }
    },
    {
      name: 'add_to_meal_plan',
      scope: 'full',
      description: 'Put a recipe (or a free-text meal) on the meal plan for one date. '
        + 'Use a recipe_id from search_recipes when the meal is a recipe in the library.',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          recipe_id: { type: 'string' },
          text: { type: 'string', description: 'Free text, when it is not a recipe in the library.' },
          slot: { type: 'string', description: 'breakfast, lunch, dinner (default) or other.' },
          servings: { type: 'number' }
        },
        required: ['date']
      },
      kald(a) {
        const d = dato(a.date);
        if (!d) return { fejl: 'Datoen skal skrives som YYYY-MM-DD.' };
        const id = String(a.recipe_id || '');
        if (id) {
          const r = srv.getItem(id);
          if (!r || r.kind !== 'recipe') return { fejl: 'Ingen opskrift med det id. Brug search_recipes først.' };
        } else if (!String(a.text || '').trim()) {
          return { fejl: 'Angiv enten recipe_id eller text.' };
        }
        const slots = ['breakfast', 'lunch', 'dinner', 'other'];
        const post = {
          id: srv.nyId(), kind: 'planEntry', date: d,
          slot: slots.includes(a.slot) ? a.slot : 'dinner',
          recipeId: id || null, text: id ? '' : String(a.text).trim().slice(0, 200),
          servings: +a.servings || null, createdAt: new Date().toISOString()
        };
        if (!srv.gemItem(post)) return { fejl: 'Kunne ikke gemme posten.' };
        const navn = id ? srv.getItem(id).title : post.text;
        return { tekst: `Lagt på madplanen ${d} (${post.slot}): ${navn}`, data: { id: post.id } };
      }
    },
    {
      name: 'get_shopping_list',
      scope: 'read',
      description: 'Read the items still missing on the shopping list.',
      inputSchema: { type: 'object', properties: {} },
      kald() {
        const varer = srv.listItems('shopItem').filter(i => !i.done);
        return {
          tekst: tekstliste(`${varer.length} varer mangler:`,
            varer.map(i => `- ${i.text}${i.group ? ' (' + i.group + ')' : ''}`)),
          data: { items: varer.map(i => ({ id: i.id, text: i.text, section: i.section || null, recipe: i.group || null })) }
        };
      }
    },
    {
      name: 'add_to_shopping_list',
      scope: 'full',
      description: 'Add items to the shopping list. Either a list of free-text items, or a '
        + 'recipe_id to add all the ingredients of that recipe.',
      inputSchema: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'string' } },
          recipe_id: { type: 'string', description: 'Adds every ingredient of that recipe.' }
        }
      },
      kald(a) {
        let tekster = (Array.isArray(a.items) ? a.items : []).map(s => String(s).trim()).filter(Boolean);
        let gruppe = '';
        if (a.recipe_id) {
          const r = srv.getItem(String(a.recipe_id));
          if (!r || r.kind !== 'recipe') return { fejl: 'Ingen opskrift med det id.' };
          gruppe = r.title;
          tekster = tekster.concat((r.ingredients || []).filter(l => !/^##/.test(l)));
        }
        if (!tekster.length) return { fejl: 'Angiv enten items eller recipe_id.' };
        let n = 0;
        for (const t of tekster.slice(0, 100)) {
          const ok = srv.gemItem({
            id: srv.nyId(), kind: 'shopItem', text: t.slice(0, 200), group: gruppe,
            section: srv.gaetAfdeling(t), done: false, createdAt: new Date().toISOString()
          });
          if (ok) n++;
        }
        return { tekst: `${n} varer føjet til indkøbslisten${gruppe ? ' fra "' + gruppe + '"' : ''}.`, data: { added: n } };
      }
    },
    {
      name: 'create_recipe',
      scope: 'full',
      description: 'Add a new recipe to the library. Ingredients and steps are one string per line.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          ingredients: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' }, category: { type: 'string' },
          servings: { type: 'number' }, prep_minutes: { type: 'number' },
          cook_minutes: { type: 'number' }, tags: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' }, url: { type: 'string' }
        },
        required: ['title', 'ingredients']
      },
      kald(a) {
        const titel = String(a.title || '').trim();
        if (!titel) return { fejl: 'Opskriften skal have en titel.' };
        const linjeliste = v => (Array.isArray(v) ? v : []).map(s => String(s).trim()).filter(Boolean).slice(0, 200);
        const ing = linjeliste(a.ingredients);
        if (!ing.length) return { fejl: 'Angiv mindst én ingrediens.' };
        const r = {
          id: srv.nyId(), kind: 'recipe', title: titel.slice(0, 200),
          description: String(a.description || '').slice(0, 2000),
          ingredients: ing, instructions: linjeliste(a.instructions),
          category: String(a.category || ''), servings: +a.servings || null,
          prepMin: +a.prep_minutes || null, cookMin: +a.cook_minutes || null, totalMin: null,
          yieldText: '', tags: linjeliste(a.tags).slice(0, 8), rating: 0, favorite: false,
          notes: String(a.notes || '').slice(0, 4000), url: String(a.url || '').slice(0, 500),
          createdAt: new Date().toISOString()
        };
        if (!srv.gemItem(r)) return { fejl: 'Kunne ikke gemme opskriften (for stor?).' };
        return { tekst: `Oprettet "${r.title}" [${r.id}]`, data: kort(r) };
      }
    },
    {
      name: 'update_recipe',
      scope: 'full',
      description: 'Change fields on an existing recipe. Only the fields you send are changed. '
        + 'Use rating to give it stars (0-5).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' }, description: { type: 'string' },
          ingredients: { type: 'array', items: { type: 'string' } },
          instructions: { type: 'array', items: { type: 'string' } },
          category: { type: 'string' }, servings: { type: 'number' },
          rating: { type: 'number' }, favorite: { type: 'boolean' },
          notes: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }
        },
        required: ['id']
      },
      kald(a) {
        const r = srv.getItem(String(a.id || ''));
        if (!r || r.kind !== 'recipe') return { fejl: 'Ingen opskrift med det id.' };
        const linjeliste = v => (Array.isArray(v) ? v : []).map(s => String(s).trim()).filter(Boolean).slice(0, 200);
        if (a.title !== undefined) r.title = String(a.title).trim().slice(0, 200) || r.title;
        if (a.description !== undefined) r.description = String(a.description).slice(0, 2000);
        if (a.ingredients !== undefined) r.ingredients = linjeliste(a.ingredients);
        if (a.instructions !== undefined) r.instructions = linjeliste(a.instructions);
        if (a.category !== undefined) { r.category = String(a.category); r.catChecked = true; }
        if (a.servings !== undefined) r.servings = +a.servings || null;
        if (a.rating !== undefined) r.rating = Math.max(0, Math.min(5, Math.round(+a.rating) || 0));
        if (a.favorite !== undefined) r.favorite = !!a.favorite;
        if (a.notes !== undefined) r.notes = String(a.notes).slice(0, 4000);
        if (a.tags !== undefined) r.tags = linjeliste(a.tags).slice(0, 8);
        r.updatedAt = new Date().toISOString();
        if (!srv.gemItem(r)) return { fejl: 'Kunne ikke gemme ændringen.' };
        return { tekst: `Opdateret "${r.title}" [${r.id}]`, data: kort(r) };
      }
    }
  ];

  /* -------------------------------------------------------------- json-rpc */

  const fejl = (id, kode, besked) => ({
    jsonrpc: '2.0', id: id === undefined ? null : id, error: { code: kode, message: besked }
  });
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });

  function behandl(besked, auth) {
    if (!besked || besked.jsonrpc !== '2.0' || typeof besked.method !== 'string') {
      return fejl(besked && besked.id, -32600, 'Invalid Request');
    }
    const { id, method, params } = besked;

    if (method === 'initialize') {
      const oensket = params && params.protocolVersion;
      return ok(id, {
        protocolVersion: PROTOKOLLER.includes(oensket) ? oensket : PROTOKOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'kokkeri', title: 'Kokkeri', version: String(srv.version) },
        instructions: 'Kokkeri is the user\'s own recipe library, meal plan and shopping list. '
          + 'The recipes are theirs - never invent recipes or ids, always read an id from '
          + 'search_recipes or what_can_i_cook first. Ingredients and instructions are one '
          + 'string per line. Dates are YYYY-MM-DD. The library is Danish; keep titles and '
          + 'ingredients in the language they are already written in.'
      });
    }
    if (method === 'ping') return ok(id, {});
    /* Notifikationer (ingen id) besvares med 202 og TOM krop - se haandter(). */
    if (method.startsWith('notifications/')) return null;

    if (method === 'tools/list') {
      /* Vis kun det, noeglen maa - saa foreslaar modellen ikke noget, der
       * alligevel bliver afvist. Listen er en hjaelp, ikke en spaerring:
       * tools/call tjekker ALLIGEVEL igen. */
      return ok(id, {
        tools: VAERKTOEJER.filter(v => srv.maa(auth, v.scope)).map(v => ({
          name: v.name, description: v.description, inputSchema: v.inputSchema
        }))
      });
    }

    if (method === 'tools/call') {
      const navn = params && params.name;
      const v = VAERKTOEJER.find(x => x.name === navn);
      if (!v) return fejl(id, -32602, `Unknown tool: ${navn}`);
      if (!srv.maa(auth, v.scope)) {
        return ok(id, { isError: true, content: [{ type: 'text',
          text: `Denne adgang er "${auth.scope}" og må kun læse. Giv forbindelsen fuld adgang i Kokkeri under Indstillinger.` }] });
      }
      let svar;
      try {
        svar = v.kald((params && params.arguments) || {});
      } catch (e) {
        srv.logError(`mcp ${navn}: ${e && e.stack ? e.stack : e}`);
        return ok(id, { isError: true, content: [{ type: 'text', text: 'Værktøjet fejlede. Se Kokkeris serverlog.' }] });
      }
      /* Fejl fra et VAERKTOEJ er ikke protokolfejl - de skal tilbage som et
       * resultat med isError, saa modellen kan laese dem og rette op. */
      if (svar.fejl) return ok(id, { isError: true, content: [{ type: 'text', text: svar.fejl }] });
      return ok(id, Object.assign({ content: [{ type: 'text', text: svar.tekst }] },
        svar.data ? { structuredContent: svar.data } : {}));
    }

    return fejl(id, -32601, `Method not found: ${method}`);
  }

  /* ------------------------------------------------------------------ http */

  async function haandter(req, res) {
    /* GET og DELETE hoerer til den serverstyrede SSE-stroem, som denne server
     * ikke tilbyder - alt besvares i selve POST-svaret. */
    if (req.method === 'GET' || req.method === 'DELETE') {
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: 'method_not_allowed', message: 'Kokkeri svarer kun MCP på POST.' }));
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }

    /* DNS-rebinding: en browser paa et fremmed site maa ikke kunne naa herind.
     * Kommer der ingen Origin (Claude Code, Desktop), er der intet at tjekke. */
    const origin = req.headers.origin;
    if (origin) {
      const vaert = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      let god = false;
      try { god = new URL(origin).host === vaert; } catch (e) { god = false; }
      if (!god) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_origin', message: 'Origin not allowed.' }));
        return;
      }
    }

    const auth = srv.godkendMcp(req);
    if (!auth) {
      /* WWW-Authenticate er HELE indgangen til OAuth: uden resource_metadata
       * kan claude.ai ikke finde autorisationsserveren og opgiver forbindelsen
       * - uden at noget ser i stykker ud (RFC 9728). */
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': srv.oauthUdfordring(req) });
      res.end(JSON.stringify({ error: 'invalid_token',
        message: 'Send en gyldig Kokkeri-nøgle som "Authorization: Bearer …", eller forbind med OAuth.' }));
      return;
    }

    let krop;
    try {
      krop = await srv.readJsonBody(req);       // maa ogsaa vaere et array (JSON-RPC-bundt)
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fejl(null, -32700, 'Parse error')));
      return;
    }

    const flere = Array.isArray(krop);
    const svar = (flere ? krop : [krop]).map(b => behandl(b, auth)).filter(Boolean);

    /* Kun notifikationer i bundtet: kvitter uden krop, som protokollen kraever.
     * Svarer man med JSON, brokker klienten sig. */
    if (!svar.length) { res.writeHead(202); res.end(); return; }

    const data = JSON.stringify(flere ? svar : svar[0]);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'MCP-Protocol-Version': PROTOKOL,
      'Content-Length': Buffer.byteLength(data)
    });
    res.end(data);
  }

  return { haandter, behandl, VAERKTOEJER };
}

module.exports = { opret, PROTOKOL };
