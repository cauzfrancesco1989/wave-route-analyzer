# Wave Route Analyzer V3.3

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
