"""
compute_crime_exposure_rate.py

Builds cer_by_station.json — the raw per-station, per-radius, per-month, per-hour
crime and ambient-population counts your dashboard needs to compute CER
(Crime Exposure Rate = crime_count / ambient_population * 10,000).

WHY RAW COUNTS, NOT PRE-DIVIDED CER:
CER is not additive. If the dashboard wants "CER for Spring," it can't average
three months of CER values — it has to sum crime and sum ambient across those
months first, THEN divide once. So this script stores the ingredients
(crime count, ambient count) and temporal.js does the final division at
whatever time-grain the user is viewing (month / hour / season).

OUTPUT SHAPE:
{
  "Station Name": {
    "150": {
      "1": { "0": {"crime": 3, "ambient": 1200}, "1": {...}, ..., "23": {...} },
      "2": { ... },
      ...
      "12": { ... }
    },
    "200": { ... }
  },
  "Another Station": { ... }
}

============================================================================
CONFIG — everything you're likely to need to change lives here.
Run this once, and if you get a KeyError or empty results, it's almost
certainly one of these values needing a fix.
============================================================================
"""

import json
import os

# ---------------------------------------------------------------------------
# 1. FILE PATHS — adjust these to match your actual repo layout.
# ---------------------------------------------------------------------------

# Ambient population files, one per radius, produced by
# clean_ambient_hourly_2025_data.py. Filename pattern assumed from memory:
AMBIENT_FILE_TEMPLATE = "../dashboard/web_dashboard/public/data/monthy_hour_of_day_202501_202606_within_{radius}m.json"

# Radii you've generated ambient files for. Adjust if you only have some of these.
RADII = [50, 100, 150, 200, 250]

# Station locations. Assumed GeoJSON with FeatureCollection of Point features,
# property "STATION" holding the name — matching what temporal.js reads
# (t.properties.STATION). Adjust path + property name if different.
STATIONS_FILE = "../dashboard/web_dashboard/public/data/transit.json"
STATION_NAME_PROPERTY = "STATION"  # unconfirmed — matches temporal.js's t.properties.STATION

# Crime data — confirmed GeoJSON FeatureCollection, same structure temporal.js
# already reads (f.geometry.coordinates as [lng, lat], f.properties.MONTH/HOUR
# as strings). Adjust path if this isn't where it lives.
CRIME_FILE = "../dashboard/web_dashboard/public/data/crimes_2025.json"

# ---------------------------------------------------------------------------
# 2. AMBIENT RECORD FIELD NAMES — guessed from memory of your project
#    (you settled on unique_ad_id_count as the ambient population metric).
#    Each record in the ambient JSON is assumed to look roughly like:
#    {"h3_l12": "8a2a1072...", "month": 1, "hour": 0, "unique_ad_id_count": 42}
# ---------------------------------------------------------------------------

AMBIENT_HEX_FIELD = "h3_l12"
AMBIENT_MONTH_FIELD = "month"          # format: "2025-04" (year-month string)
AMBIENT_HOUR_FIELD = "hour_of_day"     # confirmed from actual file sample
AMBIENT_COUNT_FIELD = "unique_ad_id_count"

# ---------------------------------------------------------------------------
# 3. OUTPUT
# ---------------------------------------------------------------------------

OUTPUT_FILE = "../dashboard/web_dashboard/public/data/cer_by_station.json"


from geopy.distance import geodesic

# ============================================================================
# Distance helper — geodesic (geopy), matching clean_ambient_hourly_2025_data.py
# exactly. Using haversine here instead would risk a hex or crime falling on
# a different side of the radius boundary than it does in the ambient-filtering
# script, which would make CER inconsistent with the buffer definition already
# used elsewhere in your paper. Install with: pip install geopy --break-system-packages
# ============================================================================

def distance_meters(lat1, lng1, lat2, lng2):
    return geodesic((lat1, lng1), (lat2, lng2)).m


def hex_center(h3_index):
    """
    Returns (lat, lng) center of an H3 cell.
    Tries the h3-py v4 API first, falls back to v3.
    Install with: pip install h3 --break-system-packages
    """
    import h3
    if hasattr(h3, "cell_to_latlng"):       # h3-py v4+
        return h3.cell_to_latlng(h3_index)
    elif hasattr(h3, "h3_to_geo"):          # h3-py v3
        return h3.h3_to_geo(h3_index)
    else:
        raise RuntimeError("Unrecognized h3 library version — check `pip show h3`.")


# ============================================================================
# Load stations
# ============================================================================

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
# Ambient population — per station, per radius, per month, per hour
# ============================================================================

def compute_ambient(stations, radius):
    """
    Returns: { station_name: { month(str): { hour(str): ambient_count } } }
    A hex within `radius` meters of a station contributes to that station's
    bucket. Hexes near multiple stations contribute to each — this is the
    same overlap-allowed approach already used for buffer analysis, and it's
    consistent with the double-counting caveat already in your Methods.
    """
    path = AMBIENT_FILE_TEMPLATE.format(radius=radius)
    print(f"  Loading ambient file: {path}")

    with open(path, "r") as f:
        records = json.load(f)

    # station_name -> month -> hour -> ambient total
    result = {s["name"]: {} for s in stations}

    # Cache hex centers so we don't recompute for repeated hex ids across
    # month/hour rows in the same file.
    hex_center_cache = {}

    for i, rec in enumerate(records):
        if i % 200000 == 0 and i > 0:
            print(f"    ...{i} ambient records processed")

        h = rec.get(AMBIENT_HEX_FIELD)
        month_raw = rec.get(AMBIENT_MONTH_FIELD)   # e.g. "2025-04"
        hour = rec.get(AMBIENT_HOUR_FIELD)
        count = rec.get(AMBIENT_COUNT_FIELD)

        if h is None or month_raw is None or hour is None or count is None:
            continue  # skip malformed rows rather than crashing the whole run

        try:
            # "2025-04" -> 4. This discards the year, so if your ambient data
            # spans multiple years (2025-04 AND 2026-04, say), those get
            # merged into the same "month 4" bucket. That matches how your
            # crime-side month grouping already works (MONTH column, no year
            # split), so it's consistent — but flag it if that's not what you want.
            month_int = int(month_raw.split("-")[1])
        except (ValueError, IndexError):
            continue
        try:
            year_str, month_str = month_raw.split("-")
            year_int = int(year_str)
            month_int = int(month_str)
        except (ValueError, IndexError):
            continue

        if year_int != 2025:
            continue  # drop 2026 records — crime data is 2025-only, so keeping
                    # 2026 would double-count Jan-Jun ambient data relative to Jul-Dec
                

        if h not in hex_center_cache:
            hex_center_cache[h] = hex_center(h)
        hex_lat, hex_lng = hex_center_cache[h]

        month_key = str(month_int)
        hour_key = str(int(hour))

        for s in stations:
            dist = distance_meters(s["lat"], s["lng"], hex_lat, hex_lng)
            if dist <= radius:
                station_bucket = result[s["name"]].setdefault(month_key, {})
                station_bucket[hour_key] = station_bucket.get(hour_key, 0) + count

    return result


# ============================================================================
# Crime counts — per station, per radius, per month, per hour
# ============================================================================

def load_crimes():
    """
    Loads the crime GeoJSON FeatureCollection. Coordinates are [lng, lat]
    (standard GeoJSON order) — note this is reversed from (lat, lng).
    MONTH/HOUR come in as strings (e.g. "10", "15"), so they're cast to int.
    Rows with missing/malformed values or (0,0) coordinates are skipped
    rather than crashing the run, matching how temporal.js already guards
    against bad geometry.
    """
    with open(CRIME_FILE, "r") as f:
        geojson = json.load(f)

    crimes = []
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
            continue

        crimes.append({"month": month, "hour": hour, "lat": lat, "lng": lng})
    return crimes


def compute_crime(stations, crimes, radius):
    """
    Returns: { station_name: { month(str): { hour(str): crime_count } } }
    Same overlap-allowed assignment as ambient, so crime and ambient are
    counted consistently for every station/radius pair.
    """
    result = {s["name"]: {} for s in stations}

    for i, c in enumerate(crimes):
        if i % 100000 == 0 and i > 0:
            print(f"    ...{i} crime records processed")

        month_key = str(c["month"])
        hour_key = str(c["hour"])

        for s in stations:
            dist = distance_meters(s["lat"], s["lng"], c["lat"], c["lng"])
            if dist <= radius:
                station_bucket = result[s["name"]].setdefault(month_key, {})
                station_bucket[hour_key] = station_bucket.get(hour_key, 0) + 1

    return result


# ============================================================================
# Combine + write
# ============================================================================

def merge(stations, ambient_by_station, crime_by_station):
    """
    Combines ambient + crime dicts (same station/month/hour keys) into the
    final {crime, ambient} cell structure for one radius.
    """
    merged = {}
    for s in stations:
        name = s["name"]
        months = set(ambient_by_station.get(name, {}).keys()) | set(crime_by_station.get(name, {}).keys())
        merged[name] = {}
        for month_key in months:
            hours = set(ambient_by_station.get(name, {}).get(month_key, {}).keys()) | \
                    set(crime_by_station.get(name, {}).get(month_key, {}).keys())
            merged[name][month_key] = {}
            for hour_key in hours:
                ambient_count = ambient_by_station.get(name, {}).get(month_key, {}).get(hour_key, 0)
                crime_count = crime_by_station.get(name, {}).get(month_key, {}).get(hour_key, 0)
                merged[name][month_key][hour_key] = {
                    "crime": crime_count,
                    "ambient": ambient_count
                }
    return merged


def main():
    print("Loading stations...")
    stations = load_stations()
    print(f"  Found {len(stations)} stations.")

    print("Loading crime data...")
    crimes = load_crimes()
    print(f"  Found {len(crimes)} usable crime records.")

    output = {s["name"]: {} for s in stations}

    for radius in RADII:
        print(f"\nProcessing radius {radius}m...")
        ambient_by_station = compute_ambient(stations, radius)
        crime_by_station = compute_crime(stations, crimes, radius)
        merged = merge(stations, ambient_by_station, crime_by_station)

        for name in output:
            output[name][str(radius)] = merged.get(name, {})

    print(f"\nWriting output to {OUTPUT_FILE}...")
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f)

    print("Done.")


if __name__ == "__main__":
    main()