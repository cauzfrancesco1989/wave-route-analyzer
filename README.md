# Wave Route Analyzer V3.24

V3.24 adds searchable Origin and Destination locations using the Photon geocoder (OpenStreetMap data). Search is explicit (button/Enter), not continuous autocomplete. Search results prefer port/harbour/marina features where available. Selecting a result places the corresponding pin; the pin remains draggable and the existing map-pick controls remain available. Waypoints are unchanged.

The app uses a small server-side proxy at `/api/geocode` and limits requests to a reasonable cadence. Photon is used as a public geocoding service and its availability/usage limits should be respected.
