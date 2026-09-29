# Wave Route Analyzer V3.1 Web App

Browser UI + Vercel Python Function + Copernicus Marine.

## What you get

- Browser-only user experience: no Python installation on the user's PC.
- Maritime routing using the existing working `searoute-ts` frontend.
- Avoid Suez / Avoid Panama.
- Route distance displayed in nautical miles (NM).
- Historical significant wave height Hs = Copernicus Marine `VHM0`.
- Copernicus dataset: `cmems_mod_glo_wav_my_0.2deg_PT3H-i`.
- Historical period choices: 3 months, 6 months, 1 year, 5 years, 10 years, 20 years.
- Credentials never enter the browser. They live in Vercel Environment Variables.

## Deploy without installing Python

1. Create a GitHub repository and upload this folder.
2. In Vercel, create a new project and import that GitHub repository.
3. In Vercel Project Settings -> Environment Variables, add:
   - `COPERNICUSMARINE_SERVICE_USERNAME`
   - `COPERNICUSMARINE_SERVICE_PASSWORD`
4. Redeploy.
5. Open the resulting `vercel.app` URL.

Vercel provides a Python runtime for Functions and installs dependencies from `requirements.txt`.

## Copernicus account

Use your normal Copernicus Marine account credentials. Do not put them into `public/index.html` or commit them to GitHub.

## API

- GET `/api/health`
- POST `/api/hs`

The API uses Copernicus Marine Toolbox `read_dataframe()` with the `timeseries`
service, which is optimized for long time series over a small geographic area.

## Important engineering note

The returned Hs statistics are based on the full 3-hourly series retrieved for each
sampled route point. The frontend samples the maritime route spatially; it does not
claim to resolve conditions between those route points. This is a weather/ocean
climate analysis tool, not a certified navigation or operational weather service.


V3.1 fixes the frontend/API response mapping and sends all sampled route points in a single request. The chart distance axis is displayed in nautical miles.
