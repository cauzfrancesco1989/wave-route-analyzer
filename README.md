# Wave Route Analyzer V3.20

Browser-based maritime route and historical wave analysis tool.

## V3.20 changes
- Reduced the vessel heading boat marker size on the map.
- Moved the selected-point wave-direction rose from the full-screen modal into the left analysis panel, so the map remains fully visible.
- Added a map display switch to show wave-direction roses directly at all sampled calculation points.
- Vessel heading and wave-rose map markers can be displayed together; clicking either marker updates the rose in the left panel.
- The selected-point rose retains the vessel heading arrow and relative-sea-state summary.
- Existing V3.19 route-colouring modes retained: no colouring, Beaufort (indicative wind correlation with disclaimer), and WMO/Douglas based on Mean Hs.
- Existing routing, waypoint, seasonal filtering, Copernicus VHM0/VMDR analysis, CSV export and satellite basemap features retained.

## Deployment
Deploy the folder contents to Vercel as in previous versions. Keep the Copernicus Marine credentials in Vercel Environment Variables:
- `COPERNICUSMARINE_SERVICE_USERNAME`
- `COPERNICUSMARINE_SERVICE_PASSWORD`
