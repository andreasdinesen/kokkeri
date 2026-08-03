"""Trimning af app-filerne FOER de pakkes i runens install-script.

Kilderne i app/ beholder alle kommentarer og indrykning - det er kun
payloaden der slankes, saa install-scriptet holder sig under MAX_ARG_STRLEN.

JS-trimningen er bevidst konservativ: den fjerner kun HELE kommentarlinjer,
indrykning og tomme linjer, og roerer ikke inline-kommentarer. Grunden er, at
inline-kommentarer kraever fuld regex-literal-detektion (`a / b` vs `/regex/`),
og en fejl dér ville aendre programmets betydning uden at bryde syntaksen.
Der trackes strenge og template literals (inkl. nested ${...}), saa fx en URL
paa egen linje inde i en HTML-template ikke bliver opfattet som en kommentar.
"""
import re


def trim_js(src):
    ud = []
    i, n = 0, len(src)
    stak = []          # 'tmpl' = inde i `...`, 'expr' = inde i ${...}
    linje = []         # den linje vi er ved at samle (kun uden for templates)
    kun_kommentar = None   # None = ikke afgjort endnu for denne linje

    def skyl():
        """Afslut den aktuelle linje: drop den hvis den kun var kommentar."""
        nonlocal linje, kun_kommentar
        s = ''.join(linje)
        if kun_kommentar or not s.strip():
            linje, kun_kommentar = [], None
            return
        ud.append(s.strip())
        ud.append('\n')
        linje, kun_kommentar = [], None

    def put(t):
        if stak:
            ud.append(t)      # inde i template: bevar alt uroert
        else:
            linje.append(t)

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''

        # --- inde i template literal ---
        if stak and stak[-1] == 'tmpl':
            if c == '\\':
                ud.append(src[i:i + 2]); i += 2; continue
            if c == '`':
                stak.pop(); ud.append(c); i += 1; continue
            if c == '$' and nxt == '{':
                stak.append('expr'); ud.append('${'); i += 2; continue
            ud.append(c); i += 1; continue

        # --- linjeskift ---
        if c == '\n':
            if stak:
                ud.append(c)
            else:
                skyl()
            i += 1
            continue

        # --- kommentarer (kun uden for strenge/templates) ---
        if c == '/' and nxt == '/':
            j = src.find('\n', i)
            j = n if j < 0 else j
            if not stak and not ''.join(linje).strip():
                kun_kommentar = True        # hele linjen er kommentar -> droppes
                i = j
                continue
            put(src[i:j])                   # inline-kommentar: bevares urørt
            i = j
            continue
        if c == '/' and nxt == '*':
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            blok = src[i:j]
            alene = not stak and not ''.join(linje).strip()
            if alene and blok.endswith('*/'):
                # blokkommentar der starter linjen: drop den (og dens linjeskift)
                i = j
                while i < n and src[i] in ' \t':
                    i += 1
                if i < n and src[i] == '\n':
                    i += 1
                linje, kun_kommentar = [], None
                continue
            put(' ' if not stak else blok)
            i = j
            continue

        # --- strenge ---
        if c in '"\'':
            q, j = c, i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2; continue
                if src[j] == q:
                    j += 1; break
                j += 1
            put(src[i:j]); i = j; continue

        if c == '`':
            if not stak:
                ud.append(''.join(linje).lstrip() if not kun_kommentar else '')
                linje, kun_kommentar = [], None
            stak.append('tmpl'); ud.append(c); i += 1; continue

        if c == '}' and stak and stak[-1] == 'expr':
            stak.pop(); ud.append(c); i += 1; continue

        put(c)
        i += 1

    skyl()
    return ''.join(ud)


def trim_css(src):
    s = re.sub(r'/\*.*?\*/', '', src, flags=re.S)     # kommentarer
    s = re.sub(r'\s*\n\s*', '\n', s)                  # indrykning
    s = re.sub(r'\n{2,}', '\n', s)                    # tomme linjer
    s = re.sub(r'\s*([{;:,])\s*', r'\1', s)           # luft om skilletegn
    s = re.sub(r';?\s*}', '}', s)                     # sidste semikolon
    return s.strip()


def trim_html(src):
    s = re.sub(r'<!--.*?-->', '', src, flags=re.S)
    return re.sub(r'\n\s*\n+', '\n', s).strip() + '\n'
