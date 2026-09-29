# Wave Route Analyzer V3.9

Browser UI + Vercel Python Function + Copernicus Marine.

## V3.2 changes
- Select origin and destination directly on the map.
- Origin/destination markers are draggable.
- Explicit point-picking buttons.
- Historical Hs request returns full statistics directly from the backend.
- Diagnostic table shows valid points and the number of 3-hourly observations used at every route point.
- CSV includes observation counts.
- No Copernicus credentials are exposed in browser JavaScript.

## Deploy
1. Push these files to the connected GitHub repository.
2. Vercel automatically creates a new deployment from `main`.
3. Keep the following Vercel Production environment variables:
   - `COPERNICUSMARINE_SERVICE_USERNAME`
   - `COPERNICUSMARINE_SERVICE_PASSWORD`

No local Python installation is required.

## Dataset
Copernicus Marine Global Ocean Waves Reanalysis:
`cmems_mod_glo_wav_my_0.2deg_PT3H-i`

Variable: `VHM0` (spectral significant wave height), 3-hourly.


## V3.3 updates

- Choose the number of route sampling points: 10, 20, 30, 50, or 100.
- Choose a seasonal filter:
  - Season 1: December, January, February
  - Season 2: March, April, May
  - Season 3: June, July, August
  - Season 4: September, October, November
  - All seasons
- The seasonal filter is applied to the 3-hourly Copernicus VHM0 observations before calculating statistics.
- The historical period selector remains the outer time window; the season selector filters the months inside that window.
- Vercel backend maximum route sample points increased from 24 to 100.


## V3.4 fix

The seasonal filter now handles both Copernicus Marine dataframe formats:
- `time` exposed as a dataframe column;
- `time` exposed as a DatetimeIndex.

Season 1 = Dec/Jan/Feb, Season 2 = Mar/Apr/May, Season 3 = Jun/Jul/Aug, Season 4 = Sep/Oct/Nov.


## V3.5 fix

Fixed the seasonal filter for Copernicus responses where the time coordinate is a pandas `DatetimeIndex`.
The code now uses `.month` for a `DatetimeIndex` and `.dt.month` for a pandas Series.


## V3.6 updates

- Added vessel heading visualization at every sampled route point.
- Heading is calculated from the local route geometry as a bearing clockwise from North (0° = North, 90° = East, 180° = South, 270° = West).
- Small arrows are displayed on the map and can be enabled/disabled with the "Show vessel heading arrows on map" checkbox.
- Clicking/hovering an arrow shows heading, route distance, Mean Hs and P95 Hs.
- Heading is included in the Copernicus diagnostic table and exported CSV.
- Wave direction is not yet included; these arrows represent the vessel/route heading only.


## V3.7 updates

- Added Copernicus `VMDR` mean wave direction alongside `VHM0`.
- `VMDR` is the direction waves come FROM, clockwise from True North.
- Added orange wave arrows on the map. The orange arrow points in the propagation direction; the tooltip reports the wave direction FROM.
- Added relative wave angle = wave-from direction minus vessel heading, normalized to -180°..+180°.
  - 0° = head seas
  - ±90° = beam seas
  - ±180° = following seas
- Added qualitative sea-state regime: Head seas, Bow quartering, Beam seas, Stern quartering, Following seas.
- Added wave-direction observation count and direction fields to the diagnostic table and CSV export.
- Seasonal filtering is applied consistently to VHM0 and VMDR.


## V3.8 updates

- Replaced persistent orange wave-direction arrows with a historical wave-direction distribution (wind-rose style polar chart).
- Added a small top-down boat symbol at each sampled route point, rotated to the local vessel heading.
- Clicking a boat opens the directional rose for that point.
- The rose uses the individual historical `VMDR` observations and 16 compass sectors of 22.5°.
- The rose is explicitly based on wave direction **FROM** which the waves arrive, clockwise from True North.
- The vessel heading is shown as a reference value; the panel also summarizes the distribution into head seas, bow quartering, beam seas, stern quartering and following seas.
- CSV export now includes the 16 directional bin counts.


## V3.9 updates

- Added up to 3 optional intermediate waypoints.
- Route is calculated sequentially: Origin → Waypoint 1 → Waypoint 2 → Waypoint 3 → Destination.
- Empty waypoint fields are skipped.
- Each waypoint can be entered by latitude/longitude or selected directly on the map.
- Waypoint markers are draggable.
- Maritime restrictions (Suez/Panama) are applied to every leg.
- Total route distance is the sum of all routed legs and endpoint snap distances.
