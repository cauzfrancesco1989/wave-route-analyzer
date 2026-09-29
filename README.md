# Wave Route Analyzer V3.10

Browser-based maritime route and historical wave analysis tool.

## V3.10 changes
- Seasonal filtering now explicitly keeps the selected 3 calendar months in **every year of the selected historical interval**. Example: 10 years + Season 1 = December, January and February across all 10 years.
- The diagnostic reports both the full-period observation count and the observations retained by the seasonal filter.
- Added a draggable vertical splitter between the input/output panel and the map.
- Added the supplied Jumbo logo in the top-right header.
- Existing V3.9 functionality retained, including up to 3 intermediate waypoints, Hs/VMDR analysis, directional rose, vessel heading, and CSV export.

## Deployment
Deploy the folder contents to Vercel as in previous versions. Keep the Copernicus Marine credentials in Vercel Environment Variables:
- `COPERNICUSMARINE_SERVICE_USERNAME`
- `COPERNICUSMARINE_SERVICE_PASSWORD`
