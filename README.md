# Wave Route Analyzer V3.2

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
