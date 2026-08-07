import json
import ijson
import h3
import pandas as pd
from geopy.distance import geodesic

# ============================================================================
# CONFIG
# ============================================================================

INPUT_FILE = '../dashboard/web_dashboard/public/data/monthy_hour_of_day_202501_202606_within_100m.json'
STATIONS_INPUT_FILE = '../dashboard/web_dashboard/public/data/transit.json'

MAX_DISTANCE = 50  # meters

OUTPUT_FILE = f'../dashboard/web_dashboard/public/data/monthy_hour_of_day_202501_202606_within_{MAX_DISTANCE}m.json'

# ============================================================================
# LOAD STATIONS (small file, safe to load normally)
# ============================================================================

print("Loading station locations...")
stations_df = pd.read_json(STATIONS_INPUT_FILE)

station_points = []
for _, row in stations_df.iterrows():
    coords = row['features']['geometry']['coordinates']
    station_points.append((coords[1], coords[0]))  # (lat, lng)

print(f"Loaded {len(station_points)} stations.")

# ============================================================================
# FILTER LOGIC (with memoization — same hex ID only gets computed once)
# ============================================================================

hex_cache = {}

def within_radius(hex_id, max_distance):
    cached = hex_cache.get(hex_id)
    if cached is not None:
        return cached

    lat, lng = h3.cell_to_latlng(hex_id)
    result = False
    for station_pt in station_points:
        if geodesic((lat, lng), station_pt).m <= max_distance:
            result = True
            break

    hex_cache[hex_id] = result
    return result

# ============================================================================
# STREAM THROUGH THE BIG FILE, RECORD BY RECORD
# ============================================================================

print(f"Streaming through {INPUT_FILE} and filtering to {MAX_DISTANCE}m...")

checked = 0
kept = 0

with open(INPUT_FILE, 'rb') as infile, open(OUTPUT_FILE, 'w') as outfile:
    outfile.write('[\n')
    first = True

    for record in ijson.items(infile, 'item'):
        checked += 1

        if within_radius(record['h3_l12'], MAX_DISTANCE):
            if not first:
                outfile.write(',\n')
            outfile.write(json.dumps(record))
            first = False
            kept += 1

        if checked % 100000 == 0:
            print(f"Checked {checked:,} | Kept {kept:,} | Unique hexes cached: {len(hex_cache):,}")

    outfile.write('\n]')

print(f"Done. Checked {checked:,} records total, kept {kept:,} within {MAX_DISTANCE}m.")
print(f"Unique hexes seen: {len(hex_cache):,}")
print(f"Output written to: {OUTPUT_FILE}")