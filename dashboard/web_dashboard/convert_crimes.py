import csv
import json
from pyproj import Transformer

INPUT_FILE = '/Users/edentsega/crime_dashboard_fixed/Data/crimedata_csv_AllNeighbourhoods_2020/crimedata_csv_AllNeighbourhoods_2020.csv'
OUTPUT_FILE = 'crimes_2020.json'

# Convert UTM Zone 10N to latitude/longitude
transformer = Transformer.from_crs("EPSG:32610", "EPSG:4326", always_xy=True)

features = []

with open(INPUT_FILE, newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        try:
            x = float(row.get('X', 0))
            y = float(row.get('Y', 0))
        except ValueError:
            x, y = 0.0, 0.0

        if x == 0 or y == 0:
            lng, lat = 0.0, 0.0
        else:
            lng, lat = transformer.transform(x, y)

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lng, lat]
            },
            "properties": {
                "TYPE": row.get('TYPE', ''),
                "YEAR": row.get('YEAR', ''),
                "MONTH": row.get('MONTH', ''),
                "DAY": row.get('DAY', ''),
                "HOUR": row.get('HOUR', ''),
                "MINUTE": row.get('MINUTE', ''),
                "HUNDRED_BLOCK": row.get('HUNDRED_BLOCK', ''),
                "NEIGHBOURHOOD": row.get('NEIGHBOURHOOD', ''),
                "CRIME_CATEGORY": row.get('TYPE', '')
            }
        }
        features.append(feature)

geojson = {
    "type": "FeatureCollection",
    "features": features
}

with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    json.dump(geojson, f)

print(f"Done. {len(features)} features written to {OUTPUT_FILE}")