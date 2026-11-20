// Ilévia pour TRMNL — transformation « Serverless » (Node 20).
// Assemble : horaires théoriques du métro (JSON pré-calculé, GitHub Pages),
// prochains passages bus/tram en temps réel et perturbations (open data MEL).
// Renvoie un objet `ilevia` prêt à afficher par les gabarits Liquid.

// ⚠️ À remplacer par l'URL GitHub Pages de votre dépôt (voir README).
const METRO_BASE = "https://REPLACE_ME.github.io/trmnl-ilevia/metro";
const MEL = "https://data.lillemetropole.fr/geoserver/ogc/features/v1/collections";
const TZ = "Europe/Paris";
const FETCH_TIMEOUT_MS = 3500;

const METRO_LINE_CODES = { M1: "ME1", M2: "ME2" };

async function run(input) {
  const settings = (input && input.trmnl && input.trmnl.plugin_settings && input.trmnl.plugin_settings.custom_fields_values) || {};
  const cfg = {
    metroStation: clean(settings.metro_station),
    metroDirection: clean(settings.metro_direction) || "all",
    metroDestination: clean(settings.metro_destination),
    stopName: clean(settings.stop_name),
    city: clean(settings.stop_city),
    directions: (Array.isArray(settings.bus_directions) ? settings.bus_directions : String(settings.bus_directions || "").split(/[,;]/))
      .map((s) => String(s).trim())
      .filter(Boolean),
    lines: toList(settings.lines).map((l) => l.toUpperCase()),
    max: 3, // l'écran affiche les 3 prochains passages
  };
  if (cfg.metroStation === "none") cfg.metroStation = "";
  if (cfg.metroDestination === "none") cfg.metroDestination = "";

  const now = parisNow();
  const errors = [];

  const [metroRaw, surfaceRaw, disruptionsRaw] = await Promise.all([
    cfg.metroStation ? getJson(`${METRO_BASE}/${encodeURIComponent(cfg.metroStation)}.json`).catch((e) => fail(errors, "horaires métro", e)) : null,
    cfg.stopName ? getJson(surfaceUrl(cfg)).catch((e) => fail(errors, "bus/tram", e)) : null,
    getJson(`${MEL}/dsp_ilevia:perturbations/items?f=json&limit=200`).catch((e) => fail(errors, "perturbations", e)),
  ]);

  const metro = metroRaw ? buildMetro(metroRaw, cfg, now) : null;
  const surface = surfaceRaw ? buildSurface(surfaceRaw, cfg, now) : null;

  const watched = new Set(cfg.lines);
  (metro ? metro.lines : []).forEach((l) => watched.add(METRO_LINE_CODES[l] || l));
  (surface ? surface.groups : []).forEach((g) => watched.add(g.line));
  const alerts = disruptionsRaw ? buildAlerts(disruptionsRaw, watched) : [];

  return {
    ilevia: {
      updated: fmtClock(now.minutes),
      date_label: now.label,
      metro,
      surface,
      alerts,
      alert_count: alerts.length,
      errors,
      configured: Boolean(cfg.metroStation || cfg.stopName),
    },
  };
}

// ---------- Métro (horaires théoriques) ----------

function buildMetro(data, cfg, now) {
  const blocks = [];
  for (const [line, ldata] of Object.entries(data.lines || {})) {
    for (const [dirKey, dir] of Object.entries(ldata.directions || {})) {
      if (cfg.metroDirection !== "all" && cfg.metroDirection !== dirKey) continue;
      const today = (dir.days || {})[now.serviceDate];
      const tomorrow = (dir.days || {})[now.nextServiceDate];
      const times = today ? today.t : [];
      const heads = today ? today.h : [];
      const travel = cfg.metroDestination ? (dir.travel || {})[cfg.metroDestination] : undefined;

      const departures = [];
      for (let i = 0; i < times.length && departures.length < cfg.max; i++) {
        if (times[i] < now.serviceMinutes) continue;
        const headsign = dir.headsigns[heads[i]] || dir.terminus;
        departures.push({
          time: fmtClock(times[i]),
          arrival: travel !== undefined ? fmtClock(times[i] + travel) : null,
          headsign,
          partial: headsign !== dir.terminus,
        });
      }

      const upcoming = times.filter((t) => t >= now.serviceMinutes && t <= now.serviceMinutes + 30);
      const last = times.length ? times[times.length - 1] : null;
      const nextFirst = tomorrow && tomorrow.t.length ? tomorrow.t[0] : null;

      blocks.push({
        line,
        color: "#" + (ldata.color || "000000"),
        text_color: "#" + (ldata.text_color || "FFFFFF"),
        terminus: dir.terminus,
        departures,
        frequency: frequencyLabel(upcoming),
        last: last !== null ? fmtClock(last) : null,
        ended: departures.length === 0,
        next_first: nextFirst !== null ? fmtClock(nextFirst) : null,
        destination: travel !== undefined ? (data.names || {})[cfg.metroDestination] || cfg.metroDestination : null,
        travel_minutes: travel !== undefined ? travel : null,
      });
    }
  }
  return {
    station: data.station,
    lines: [...new Set(blocks.map((b) => b.line))],
    directions: blocks,
    has_destination: blocks.some((b) => b.destination),
  };
}

function frequencyLabel(times) {
  if (times.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median <= 1) return "toutes les 1-2 min";
  return `toutes les ${median} min`;
}

// ---------- Bus / tram (temps réel) ----------

function surfaceUrl(cfg) {
  // Recherche tolérante : "République Beaux-Arts" -> nom_station ILIKE '%REPUBLIQUE%BEAUX%ARTS%'
  // Les mots génériques sont ignorés dans la recherche : le tram nomme "LILLE FLANDRES" ce que le bus appelle "GARE LILLE FLANDRES".
  const GENERIC = new Set(["GARE", "ARRET", "STATION", "METRO", "TRAM", "BUS"]);
  const all = normalize(cfg.stopName).split(" ").filter(Boolean);
  const words = all.filter((w) => !GENERIC.has(w)).length ? all.filter((w) => !GENERIC.has(w)) : all;
  let filter = `nom_station ILIKE '%${words.join("%")}%'`;
  if (cfg.lines.length) {
    const metroOnly = cfg.lines.every((l) => /^M[12]$/.test(l));
    const lines = cfg.lines.filter((l) => !/^M[12]$/.test(l));
    if (!metroOnly) filter += ` AND code_ligne IN (${lines.map((l) => `'${l.replace(/'/g, "")}'`).join(",")})`;
  }
  const qs = new URLSearchParams({ f: "json", limit: "500", "filter-lang": "cql-text", filter, sortby: "heure_estimee_depart" });
  return `${MEL}/dsp_ilevia:prochains_passages/items?${qs}`;
}

function buildSurface(data, cfg, now) {
  const rows = (data.features || []).map((f) => f.properties || {});
  if (!rows.length) {
    return { stop: cfg.stopName, groups: [], empty: true, filtered_out: false, available_directions: [], ambiguous: [] };
  }
  // Plusieurs arrêts peuvent correspondre : noms proches ("REPUBLIQUE" / "REPUBLIQUE BEAUX ARTS")
  // ou même nom dans plusieurs communes ("REPUBLIQUE" à Loos, Wattrelos, Houplines…).
  const wanted = normalize(cfg.stopName);
  const city = normalize(cfg.city);
  const keyOf = (r) => `${r.nom_station}|${r.commune || ""}`;
  const counts = new Map();
  for (const r of rows) counts.set(keyOf(r), (counts.get(keyOf(r)) || 0) + 1);
  let candidates = [...counts.keys()];
  const exactName = candidates.filter((k) => normalize(k.split("|")[0]) === wanted);
  if (exactName.length) candidates = exactName;
  if (city) {
    const inCity = candidates.filter((k) => normalize(k.split("|")[1]).includes(city));
    if (inCity.length) candidates = inCity;
  }
  // à défaut : nom le plus court, puis l'arrêt le plus desservi
  candidates.sort((a, b) => a.split("|")[0].length - b.split("|")[0].length || counts.get(b) - counts.get(a));
  const chosen = candidates[0];
  const [chosenName, chosenCity] = chosen.split("|");
  const label = (k) => {
    const [n, c] = k.split("|");
    return titleCase(n) + (c ? ` (${c})` : "");
  };
  const ambiguous = [...counts.keys()].filter((k) => k !== chosen).slice(0, 4).map(label);
  const sameNameElsewhere = [...counts.keys()].some((k) => k !== chosen && k.split("|")[0] === chosenName);

  // heure_estimee_depart est en heure locale malgré le suffixe "Z" (ex. 17:15:56Z = 17h15 à Lille).
  const nowKey = now.isoLocal; // "2026-11-20T17:16"
  const groups = new Map();
  const allDirections = new Set();
  // Filtre de direction : "Faches, Porte des Postes" garde toute direction contenant l'un des termes.
  const dirTerms = cfg.directions.map(normalize).filter(Boolean);
  for (const r of rows) {
    if (keyOf(r) !== chosen) continue;
    const local = String(r.heure_estimee_depart || "").slice(0, 16);
    if (!local || local < nowKey) continue;
    allDirections.add(`${r.code_ligne} → ${titleCase(r.sens_ligne)}`);
    if (dirTerms.length && !dirTerms.some((t) => normalize(r.sens_ligne).includes(t))) continue;
    const key = `${r.code_ligne}|${r.sens_ligne}`;
    if (!groups.has(key)) groups.set(key, { line: r.code_ligne, mode: r.code_ligne === "TRAM" ? "tram" : "bus", direction: titleCase(r.sens_ligne), times: [], first: local });
    const g = groups.get(key);
    const label = local.slice(11, 13) + "h" + local.slice(14, 16);
    if (g.times.length < Math.min(cfg.max, 4) && !g.times.includes(label)) g.times.push(label);
  }
  const sorted = [...groups.values()].sort((a, b) => (a.first < b.first ? -1 : 1)).map(({ first, ...g }) => g);
  const display = normalize(chosenName) === wanted ? cfg.stopName : titleCase(chosenName);
  return {
    stop: display + (sameNameElsewhere && chosenCity ? ` (${chosenCity})` : ""),
    groups: sorted,
    empty: sorted.length === 0,
    // Si le filtre de direction ne garde rien, on liste les directions possibles pour aider à le corriger.
    filtered_out: dirTerms.length > 0 && sorted.length === 0 && allDirections.size > 0,
    available_directions: dirTerms.length > 0 && sorted.length === 0 ? [...allDirections].sort().slice(0, 8) : [],
    ambiguous: cfg.city || normalize(chosenName) === wanted && !sameNameElsewhere ? [] : ambiguous,
  };
}

// ---------- Perturbations ----------

function buildAlerts(data, watched) {
  const seen = new Set();
  const out = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    const m = /LineRef::([^:]+):/.exec(p.cible || "");
    if (!m || !watched.has(m[1])) continue;
    const text = cleanMessage(p.message);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const line = Object.keys(METRO_LINE_CODES).find((k) => METRO_LINE_CODES[k] === m[1]) || m[1];
    out.push({ line, severe: p.type_perturbation && p.type_perturbation !== "Information", type: p.type_perturbation || "Information", text });
  }
  return out.sort((a, b) => Number(b.severe) - Number(a.severe)).slice(0, 4);
}

function cleanMessage(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/[​-‍️]/g, "")
    .replace(/[℀-⅏←-⯿\u{1F000}-\u{1FAFF}]/gu, " ") // pictogrammes / emojis (illisibles en e-ink)
    .replace(/,?\s*(sur la page[^.]*)?en cliquant\s*(\[?\s*ici\s*\]?)?\s*\.?\s*$/i, ".")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Utilitaires ----------

function parisNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "long", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  const y = +parts.year, mo = +parts.month, d = +parts.day, h = +parts.hour, mi = +parts.minute;
  const minutes = h * 60 + mi;
  // Le jour de service du métro va de ~5h à ~1h du matin : avant 4h on reste sur la veille.
  const base = new Date(Date.UTC(y, mo - 1, d));
  const service = new Date(base);
  if (h < 4) service.setUTCDate(service.getUTCDate() - 1);
  const next = new Date(service);
  next.setUTCDate(next.getUTCDate() + 1);
  const ymd = (dt) => dt.toISOString().slice(0, 10).replace(/-/g, "");
  return {
    minutes,
    serviceMinutes: h < 4 ? minutes + 1440 : minutes,
    serviceDate: ymd(service),
    nextServiceDate: ymd(next),
    isoLocal: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`,
    label: `${parts.weekday} ${d}`,
  };
}

async function getJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function fail(errors, what, e) {
  errors.push(`${what} indisponible (${e && e.name === "AbortError" ? "délai dépassé" : (e && e.message) || e})`);
  return null;
}

function fmtClock(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}h${String(m % 60).padStart(2, "0")}`;
}

function normalize(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function titleCase(s) {
  const small = new Set(["de", "du", "des", "la", "le", "les", "et", "d", "l", "a"]);
  return String(s || "")
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("")
    .replace(/\bChu\b/g, "CHU")
    .replace(/\bCrt\b/g, "CRT");
}

function toList(v) {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return String(v || "").split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

function clean(v) {
  return v === undefined || v === null ? "" : String(v).trim();
}

