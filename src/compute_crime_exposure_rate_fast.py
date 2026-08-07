"""
compute_crime_exposure_rate.py (single-pass, per-crime-type version)

Same speed approach as before (loads only the 250m ambient file, computes
each hex's station distances once, buckets into all 5 radii in one pass) —
but crime counts are now split by TYPE, so the dashboard can compute CER
filtered to whichever crime type(s) are toggled active, matching how the
existing bar chart already filters by state.activeLayers.

OUTPUT SHAPE (changed from the flat {crime, ambient} version):
{
  "Station Name": {
    "150": {
      "ambient": { "4": { "13": 6741, ... }, ... },
      "crimeByType": {
        "Theft from Vehicle": { "4": { "13": 1, ... }, ... },
        "Mischief": { "4": { "21": 1, ... }, ... }
      }
    },
    "200": { ... }
  }
}

Ambient is stored once per station/radius (it has no crime type — population
is population). Crime is split by type; a type/month/hour combo with zero
incidents simply doesn't appear in the dict, which keeps the file from
growing much despite the extra nesting (most combos are empty, given only
~29k crime records spread across 20 stations x 5 radii x ~7 types x 12
months x 24 hours).

All prior correctness fixes are still applied:
1. YEAR FILTER — ambient data limited to 2025 (crime data is 2025-only)
2. TIMEZONE SHIFT — ambient hour_of_day UTC -> Pacific local
3. STATION DEDUP — Commercial-Broadway / Waterfront collapsed to one
   coordinate each, matching main.js's dedup convention
4. Offence Against a Person and Homicide are dropped entirely via the
   (0,0) coordinate check — both are 100% masked, confirmed empirically,
   so no separate type-based filtering is needed for them.
"""

import json
import os
from geopy.distance import geodesic

# ---------------------------------------------------------------------------
# 1. FILE PATHS
# ---------------------------------------------------------------------------

MAX_RADIUS_FILE = "../dashboard/web_dashboard/public/data/monthy_hour_of_day_202501_202606_within_250m.json"
RADII = [50, 100, 150, 200, 250]

STATIONS_FILE = "../dashboard/web_dashboard/public/data/transit.json"
STATION_NAME_PROPERTY = "STATION"

CRIME_FILE = "../dashboard/web_dashboard/public/data/crimes_2025.json"

# ---------------------------------------------------------------------------
# 2. AMBIENT RECORD FIELD NAMES
# ---------------------------------------------------------------------------

AMBIENT_HEX_FIELD = "h3_l12"
AMBIENT_MONTH_FIELD = "month"
AMBIENT_HOUR_FIELD = "hour_of_day"     # UTC, per inferred pattern
AMBIENT_COUNT_FIELD = "unique_ad_id_count"

AMBIENT_YEAR_FILTER = 2025

# ---------------------------------------------------------------------------
# 3. TIMEZONE (inferred, not documented — see earlier notes)
# ---------------------------------------------------------------------------

PDT_MONTHS = {3, 4, 5, 6, 7, 8, 9, 10, 11}

def utc_hour_to_local(utc_hour, month_int):
    offset = 7 if month_int in PDT_MONTHS else 8
    return (utc_hour - offset) % 24

# ---------------------------------------------------------------------------
# 4. OUTPUT
# ---------------------------------------------------------------------------

OUTPUT_FILE = "../dashboard/web_dashboard/public/data/cer_by_station.json"


def distance_meters(lat1, lng1, lat2, lng2):
    return geodesic((lat1, lng1), (lat2, lng2)).m


def hex_center(h3_index):
    import h3
    if hasattr(h3, "cell_to_latlng"):
        return h3.cell_to_latlng(h3_index)
    elif hasattr(h3, "h3_to_geo"):
        return h3.h3_to_geo(h3_index)
    else:
        raise RuntimeError("Unrecognized h3 library version — check `pip show h3`.")


def load_stations():
    with open(STATIONS_FILE, "r") as f:
        geojson = json.load(f)

    stations = []
    seen_names = set()

    for feature in geojson["features"]:
        name = feature["properties"].get(STATION_NAME_PROPERTY, "Unknown")
        if name in seen_names:
            continue  # keep first occurrence only, matching main.js's dedup convention
        seen_names.add(name)

        lng, lat = feature["geometry"]["coordinates"]
        stations.append({"name": name, "lat": lat, "lng": lng})

    return stations


# ============================================================================
# Ambient population — single pass over the 250m file, bucketed into all radii
# (unchanged from before — ambient has no crime type)
# ============================================================================

def compute_ambient_all_radii(stations):
    """
    Returns: { radius: { station_name: { month(str): { hour(str): ambient_count } } } }
    """
    print(f"Loading ambient file: {MAX_RADIUS_FILE}")
    with open(MAX_RADIUS_FILE, "r") as f:
        records = json.load(f)
    print(f"  {len(records):,} records loaded")

    result = {r: {s["name"]: {} for s in stations} for r in RADII}
    hex_station_dist_cache = {}
    dropped_wrong_year = 0
    processed = 0

    for rec in records:
        processed += 1
        if processed % 200000 == 0:
            print(f"    ...{processed:,} ambient records processed")

        h = rec.get(AMBIENT_HEX_FIELD)
        month_raw = rec.get(AMBIENT_MONTH_FIELD)
        hour = rec.get(AMBIENT_HOUR_FIELD)
        count = rec.get(AMBIENT_COUNT_FIELD)

        if h is None or month_raw is None or hour is None or count is None:
            continue

        try:
            year_str, month_str = month_raw.split("-")
            year_int = int(year_str)
            month_int = int(month_str)
        except (ValueError, IndexError):
            continue

        if year_int != AMBIENT_YEAR_FILTER:
            dropped_wrong_year += 1
            continue

        local_hour = utc_hour_to_local(int(hour), month_int)
        month_key = str(month_int)
        hour_key = str(local_hour)

        if h not in hex_station_dist_cache:
            hex_lat, hex_lng = hex_center(h)
            hex_station_dist_cache[h] = [
                (s["name"], distance_meters(s["lat"], s["lng"], hex_lat, hex_lng))
                for s in stations
            ]

        station_dists = hex_station_dist_cache[h]

        for radius in RADII:
            for station_name, dist in station_dists:
                if dist <= radius:
                    station_bucket = result[radius][station_name].setdefault(month_key, {})
                    station_bucket[hour_key] = station_bucket.get(hour_key, 0) + count

    if dropped_wrong_year > 0:
        print(f"  Dropped {dropped_wrong_year:,} records outside {AMBIENT_YEAR_FILTER}")
    print(f"  Unique hexes processed (geodesic computed once each): {len(hex_station_dist_cache):,}")

    return result


# ============================================================================
# Crime counts — now split by TYPE
# ============================================================================

def load_crimes():
    """
    Now also keeps each record's TYPE. Offence Against a Person and Homicide
    are still dropped here via the (0,0) coordinate check — both are 100%
    masked (confirmed empirically), so they never reach the type-bucketing
    step below; no separate exclusion needed for them.
    """
    with open(CRIME_FILE, "r") as f:
        geojson = json.load(f)

    crimes = []
    skipped_masked_coords = 0

    for feature in geojson.get("features", []):
        props = feature.get("properties", {})
        geom = feature.get("geometry")
        if not geom or "coordinates" not in geom:
            continue

        try:
            month = int(props["MONTH"])
            hour = int(props["HOUR"])
        except (KeyError, ValueError, TypeError):
            continue

        lng, lat = geom["coordinates"]

        if lat == 0 and lng == 0:
            skipped_masked_coords += 1
            continue

        crime_type = props.get("TYPE", "Unknown")
        crimes.append({"month": month, "hour": hour, "lat": lat, "lng": lng, "type": crime_type})

    if skipped_masked_coords > 0:
        print(f"  Skipped {skipped_masked_coords:,} records with masked (0,0) coordinates "
              f"(includes all Offence Against a Person and Homicide records)")

    return crimes


def compute_crime_all_radii(stations, crimes):
    """
    Returns: { radius: { station_name: { crime_type: { month(str): { hour(str): count } } } } }
    Same one-distance-computation-per-point trick, now with an extra
    type-keyed layer before month/hour.
    """
    result = {r: {s["name"]: {} for s in stations} for r in RADII}
    point_dist_cache = {}

    for i, c in enumerate(crimes):
        if i % 100000 == 0 and i > 0:
            print(f"    ...{i:,} crime records processed")

        point_key = (c["lat"], c["lng"])
        if point_key not in point_dist_cache:
            point_dist_cache[point_key] = [
                (s["name"], distance_meters(s["lat"], s["lng"], c["lat"], c["lng"]))
                for s in stations
            ]

        station_dists = point_dist_cache[point_key]
        month_key = str(c["month"])
        hour_key = str(c["hour"])
        crime_type = c["type"]

        for radius in RADII:
            for station_name, dist in station_dists:
                if dist <= radius:
                    type_bucket = result[radius][station_name].setdefault(crime_type, {})
                    month_bucket = type_bucket.setdefault(month_key, {})
                    month_bucket[hour_key] = month_bucket.get(hour_key, 0) + 1

    return result


# ============================================================================
# Combine + write
# ============================================================================

def merge_one_radius(stations, ambient_by_station, crime_by_type_by_station):
    """
    Returns: { station_name: { "ambient": {month: {hour: count}},
                                "crimeByType": {type: {month: {hour: count}}} } }
    Ambient is stored once (no type dimension). crimeByType is passed through
    as-is — sparse by construction, since setdefault only creates entries
    for combos that actually had at least one incident.
    """
    merged = {}
    for s in stations:
        name = s["name"]
        merged[name] = {
            "ambient": ambient_by_station.get(name, {}),
            "crimeByType": crime_by_type_by_station.get(name, {})
        }
    return merged


def main():
    print("Loading stations...")
    stations = load_stations()
    print(f"  {len(stations)} unique stations (after dedup)")

    print("\nLoading crime data...")
    crimes = load_crimes()
    print(f"  {len(crimes):,} usable crime records")

    print("\nComputing ambient population (single pass, all radii)...")
    ambient_by_radius = compute_ambient_all_radii(stations)

    print("\nComputing crime counts by type (single pass, all radii)...")
    crime_by_radius = compute_crime_all_radii(stations, crimes)

    print("\nMerging...")
    output = {s["name"]: {} for s in stations}
    for radius in RADII:
        merged = merge_one_radius(stations, ambient_by_radius[radius], crime_by_radius[radius])
        for name in output:
            output[name][str(radius)] = merged.get(name, {"ambient": {}, "crimeByType": {}})

    print(f"\nWriting output to {OUTPUT_FILE}...")
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f)

    print("Done.")


if __name__ == "__main__":
    main()