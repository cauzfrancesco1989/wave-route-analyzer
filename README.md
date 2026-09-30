# Wave Route Analyzer V3.22

Browser-based maritime route and historical wave analysis tool.

## V3.22 changes
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


## V3.22 — Arctic routing
- Added “Allow Arctic passages” option.
- Uses searoute-ts `allowArctic: true` to enable the supported Northwest and Northeast passages.
- Arctic routing remains a graph-routing feature only: no sea-ice, seasonal navigability, or ice-class model is applied.
- Default remains OFF for safer/less surprising behaviour.


## V3.22 Arctic wave data

Arctic route points north of 53°N no longer rely exclusively on the global WAVERYS product. The backend uses Copernicus Marine's dedicated Arctic wave products: the multi-year Arctic hindcast (`cmems_mod_arc_wav_my_3km_PT1H-i`) through 31 July 2025 and the Arctic analysis/forecast dataset (`dataset-wam-arctic-1hr3km-be`) from 1 August 2022 onward, stitching the requested historical interval without overlap. This provides VHM0 and VMDR for Arctic route points where the global wave product may be masked by sea ice.
