import os

import pandas as pd
import numpy as np
import geopy as gp
from geopy.distance import geodesic
import h3

# Input file path
#INPUT_FILE = 'C:/Users/Ryan/Documents/Ambient_Data/monthy_hour_of_day_202501_202606.csv'
INPUT_FILE = '../dashboard/web_dashboard/public/data/monthy_hour_of_day_202501_202606_within_250m.json'

OUTPUT_FILE_DIRECTORY = '../dashboard/web_dashboard/public/data/'
OUTPUT_FILE_NAME = 'monthy_hour_of_day_202501_202606'

STATIONS_INPUT_FILE = '../dashboard/web_dashboard/public/data/transit.json'

# the number of rows to load (for testing purposes), set to 'None' if you want to load all data
NUM_ROWS_TO_LOAD = None
#NUM_ROWS_TO_LOAD = 20

DISPLAY_DATA = True

SAVE_DATA = True

# ============================================================================
# DATA LOADING
# ============================================================================

def load_hex_data(filepath):
    """
    Load  data from CSV file.

    Args:
        filepath (str): Path to the CSV file

    Returns:
        pd.DataFrame: Raw hex data
    """
    print(f"\n{'=' * 70}")
    print("LOADING HEX DATA")
    print(f"{'=' * 70}")
    df = None

    if 'NUM_ROWS_TO_LOAD' in globals():
        print("NUM_ROWS_TO_LOAD is a global variable")
        #df = pd.read_csv(filepath, nrows=NUM_ROWS_TO_LOAD)
        df = pd.read_json(filepath, nrows=NUM_ROWS_TO_LOAD)
    else:
        #df = pd.read_csv(filepath)
        df = pd.read_json(filepath)

    print(f"✓ Loaded {len(df):,} total records")
    print(f"✓ Columns: {', '.join(df.columns.tolist())}")

    return df

def load_transit_data(filepath):
    """
    Load transit data from CSV file.

    Args:
        filepath (str): Path to the json file

    Returns:
        pd.DataFrame: Raw transit
    """
    print(f"\n{'=' * 70}")
    print("LOADING TRANSIT DATA")
    print(f"{'=' * 70}")
    df = pd.read_json(filepath)

    print(f"✓ Loaded {len(df):,} total records")
    print(f"✓ Columns: {', '.join(df.columns.tolist())}")

    return df

def print__data(df: pd.DataFrame):
    """
    Prints data.

    Args:
        df (str): the dataframe to display

    """
    # 1. Force Pandas to display all columns
    pd.set_option('display.max_columns', None)


    print(df)

def filter_data_include_distance_away(hexDF: pd.DataFrame, transitDF: pd.DataFrame, maxDistance: int):
    filteredDF = None
    rows_list = []
    pd.set_option('display.max_columns', None)
    for index, row in hexDF.iterrows():
        rowID = row['h3_l12']
        lat, lng = h3.cell_to_latlng(rowID)
        hexPos = (lat, lng)

        hexWithinRadius = False
        for index, row in transitDF.iterrows():
            features = row['features']
            properties = features['properties']
            station = properties['STATION']
            geometry = features['geometry']
            coordsAsArray = geometry['coordinates']
            stationCoordsAsTuple = (coordsAsArray[1], coordsAsArray[0])

            distanceInMeters = geodesic(hexPos, stationCoordsAsTuple).m


            #print("distance: " + str(distanceInMeters) + " (" + station + ")")
            hexWithinRadius = (distanceInMeters <= maxDistance)
            if hexWithinRadius:
                #print(station + " -> " + str(coordsAsTuple))
                print("WITHIN RADIUS OF " + station)
                break

        if not hexWithinRadius:
            print("would ignore this hex")
        else:
            rows_list.append(row)

        print(rowID + " [" + str(lat) + ',' + str(lng) + "]")

    filteredDF = pd.DataFrame(rows_list)
    return filteredDF

def save_data(df: pd.DataFrame, maxDistance: int):
    """
        Saves data.

        Args:
            df (str): the dataframe to save

        """
    print("Saving data")

    fileName = OUTPUT_FILE_NAME + "_within_" + str(maxDistance) + "m.json"
    output_file_path = os.path.join(OUTPUT_FILE_DIRECTORY, fileName)

    df.to_json(output_file_path, orient="records", indent=4)

def main():
    print("Cleaning ambient hourly 2025 data")
    hexDF = load_hex_data(INPUT_FILE)
    transitDF = load_transit_data(STATIONS_INPUT_FILE)

    maxDistance = 150

    if DISPLAY_DATA:
        print("")
        print__data(hexDF)
        print__data(transitDF)

    if SAVE_DATA:
        print("")
        cleanedDF = filter_data_include_distance_away(hexDF, transitDF, maxDistance)
        print__data(cleanedDF)
        save_data(hexDF, maxDistance)

if __name__ == "__main__":
    main()