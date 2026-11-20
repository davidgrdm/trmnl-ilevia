#!/usr/bin/env python3
"""Génère les horaires théoriques du métro Ilévia (M1, M2) station par station.

Ilévia ne publie pas le métro en temps réel en open data : ni dans l'API
« prochains passages » (bus + tram uniquement), ni dans le GTFS-RT. On calcule
donc les passages théoriques à partir du GTFS statique, pour quelques jours,
et on publie un petit JSON par station (servi par GitHub Pages).

Usage : python3 scripts/build_metro.py <dossier_gtfs_décompressé> <dossier_sortie> [nb_jours]

Format d'un fichier <sortie>/metro/<slug>.json :
{
  "station": "République Beaux-Arts", "slug": "republique-beaux-arts",
  "generated": "2026-11-20T04:00:00+01:00",
  "lines": {
    "M1": {
      "color": "FDC41F", "text_color": "000000",
      "directions": {
        "chu-eurasante": {
          "terminus": "CHU Eurasanté",
          "headsigns": ["CHU Eurasanté"],
          "travel": {"chu-eurasante": 7, "gambetta": 1, ...},   # minutes depuis cette station
          "days": {"20261120": {"t": [325, 327, ...], "h": [0, 0, ...]}}
        }
      }
    }
  }
}
"t" = minutes depuis minuit du jour de service (peut dépasser 1440 après minuit),
"h" = index dans "headsigns" (destination réelle, utile pour les services partiels).
"""
import csv
import datetime as dt
import json
import os
import re
import statistics
import sys
import unicodedata
from collections import defaultdict
from zoneinfo import ZoneInfo

PARIS = ZoneInfo("Europe/Paris")
METRO_ROUTES = {"ME1": "M1", "ME2": "M2"}
# Nom affiché du terminus principal par (ligne, direction_id GTFS)
TERMINI = {
    ("M1", "0"): "CHU Eurasanté",
    ("M1", "1"): "4 Cantons Stade P. Mauroy",
    ("M2", "0"): "Saint-Philibert",
    ("M2", "1"): "C.H. Dron",
}
# Corrections d'affichage des noms GTFS
NAME_FIXES = {"Chu - Eurasanté": "CHU Eurasanté"}


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def pretty_headsign(h):
    # "Lille Chu - Eurasanté" -> "CHU Eurasanté" ; "Lomme Lomme-Lambersart" -> "Lomme-Lambersart"
    h = h.replace("Chu - Eurasanté", "CHU Eurasanté")
    for prefix in ("Lille ", "Lomme ", "Roubaix ", "Tourcoing ", "Villeneuve D Ascq "):
        if h.startswith(prefix) and len(h) > len(prefix):
            h = h[len(prefix):]
            break
    return h


def to_minutes(hms):
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 60 + m + (1 if s >= 30 else 0)


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        yield from csv.DictReader(f)


def main(gtfs_dir, out_dir, n_days=3):
    today = dt.datetime.now(PARIS).date()
    # Avant 4h du matin on est encore sur le jour de service de la veille
    if dt.datetime.now(PARIS).hour < 4:
        today -= dt.timedelta(days=1)
    dates = [(today + dt.timedelta(days=i)).strftime("%Y%m%d") for i in range(n_days)]

    routes = {r["route_id"]: r for r in read_csv(os.path.join(gtfs_dir, "routes.txt")) if r["route_id"] in METRO_ROUTES}

    trips = {}
    for t in read_csv(os.path.join(gtfs_dir, "trips.txt")):
        if t["route_id"] in METRO_ROUTES:
            trips[t["trip_id"]] = t
    services = {t["service_id"] for t in trips.values()}

    active = defaultdict(set)  # date -> service_ids
    for c in read_csv(os.path.join(gtfs_dir, "calendar_dates.txt")):
        if c["service_id"] in services and c["date"] in dates and c["exception_type"] == "1":
            active[c["date"]].add(c["service_id"])

    stops = {s["stop_id"]: s for s in read_csv(os.path.join(gtfs_dir, "stops.txt"))}

    def station_of(stop_id):
        s = stops[stop_id]
        parent = s.get("parent_station") or stop_id
        name = (stops.get(parent) or s)["stop_name"]
        name = NAME_FIXES.get(name, name)
        return slugify(name), name

    seqs = defaultdict(list)  # trip_id -> [(seq, slug, minutes)]
    for st in read_csv(os.path.join(gtfs_dir, "stop_times.txt")):
        if st["trip_id"] in trips:
            slug, _ = station_of(st["stop_id"])
            seqs[st["trip_id"]].append((int(st["stop_sequence"]), slug, to_minutes(st["departure_time"])))

    names = {}
    # station -> line -> dir_key -> structures
    data = defaultdict(lambda: defaultdict(dict))
    travel_samples = defaultdict(list)  # (slug, line, dir_key, to_slug) -> [minutes]

    for trip_id, calls in seqs.items():
        calls.sort()
        trip = trips[trip_id]
        line = METRO_ROUTES[trip["route_id"]]
        terminus = TERMINI[(line, trip["direction_id"])]
        dir_key = slugify(terminus)
        headsign = pretty_headsign(trip["trip_headsign"])
        for i, (_, slug, minute) in enumerate(calls[:-1]):  # pas de départ au terminus d'arrivée
            d = data[slug][line].setdefault(dir_key, {"terminus": terminus, "headsigns": [], "days": {}})
            if headsign not in d["headsigns"]:
                d["headsigns"].append(headsign)
            h = d["headsigns"].index(headsign)
            for date in dates:
                if trip["service_id"] in active[date]:
                    day = d["days"].setdefault(date, [])
                    day.append((minute, h))
            # temps de trajet vers les stations suivantes (échantillon limité)
            for _, to_slug, to_min in calls[i + 1:]:
                samples = travel_samples[(slug, line, dir_key, to_slug)]
                if len(samples) < 60:
                    samples.append(to_min - minute)

    # noms affichés des stations
    for s in stops.values():
        slug, name = station_of(s["stop_id"])
        if slug in data:
            names[slug] = name

    os.makedirs(os.path.join(out_dir, "metro"), exist_ok=True)
    generated = dt.datetime.now(PARIS).isoformat(timespec="seconds")
    index = []
    for slug, lines in sorted(data.items()):
        out = {"station": names.get(slug, slug), "slug": slug, "generated": generated, "lines": {}, "names": {}}
        for line, dirs in sorted(lines.items()):
            route = next(r for rid, r in routes.items() if METRO_ROUTES[rid] == line)
            ldata = {"color": route["route_color"], "text_color": route["route_text_color"], "directions": {}}
            for dir_key, d in sorted(dirs.items()):
                travel = {}
                for (s0, l0, k0, to_slug), samples in travel_samples.items():
                    if (s0, l0, k0) == (slug, line, dir_key):
                        travel[to_slug] = round(statistics.median(samples))
                days = {}
                for date, deps in sorted(d["days"].items()):
                    deps.sort()
                    days[date] = {"t": [m for m, _ in deps], "h": [h for _, h in deps]}
                out["names"].update({k: names.get(k, k) for k in travel})
                ldata["directions"][dir_key] = {
                    "terminus": d["terminus"],
                    "headsigns": d["headsigns"],
                    "travel": dict(sorted(travel.items(), key=lambda kv: kv[1])),
                    "days": days,
                }
            out["lines"][line] = ldata
        with open(os.path.join(out_dir, "metro", f"{slug}.json"), "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        index.append({"slug": slug, "station": out["station"], "lines": sorted(lines.keys())})

    with open(os.path.join(out_dir, "metro", "index.json"), "w", encoding="utf-8") as f:
        json.dump({"generated": generated, "dates": dates, "stations": index}, f, ensure_ascii=False, indent=1)
    print(f"{len(index)} stations, jours {dates}, services actifs: {[len(active[d]) for d in dates]}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 3)
