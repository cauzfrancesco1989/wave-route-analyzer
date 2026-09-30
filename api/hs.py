import json
import math
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

import copernicusmarine
import pandas as pd

DATASET_ID = "cmems_mod_glo_wav_my_0.2deg_PT3H-i"
ARCTIC_MY_DATASET_ID = "cmems_mod_arc_wav_my_3km_PT1H-i"
ARCTIC_NRT_DATASET_ID = "dataset-wam-arctic-1hr3km-be"
VARIABLES = ["VHM0", "VMDR"]
ARCTIC_THRESHOLD_LAT = 63.0
ICE_DATASET_ID = "cmems_mod_arc_phy_anfc_nextsim_hm"
ICE_REANALYSIS_DATASET_ID = "cmems_mod_arc_phy_my_nextsim_P1D-m"
ICE_MIN_LAT = 52.6
ICE_THRESHOLD = 0.15
ICE_NRT_START = pd.Timestamp("2019-08-01T00:00:00Z")
ICE_NRT_END = pd.Timestamp("2099-12-31T23:00:00Z")
ICE_MY_START = pd.Timestamp("1993-01-01T00:00:00Z")
ICE_MY_END = pd.Timestamp("2026-05-31T23:59:59Z")
ARCTIC_MY_START = pd.Timestamp("1964-01-01T00:00:00Z")
ARCTIC_MY_END = pd.Timestamp("2025-07-31T23:00:00Z")
ARCTIC_NRT_START = pd.Timestamp("2022-08-01T00:00:00Z")
MAX_POINTS = 100
MAX_WORKERS = 4

def percentile(values, q):
    if not values:
        return float("nan")
    xs = sorted(values)
    if len(xs) == 1:
        return xs[0]
    k = (len(xs) - 1) * q
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return xs[int(k)]
    return xs[f] + (xs[c] - xs[f]) * (k - f)

def read_point_dataset(dataset_id, lon, lat, start, end):
    return copernicusmarine.read_dataframe(
        dataset_id=dataset_id,
        variables=VARIABLES,
        minimum_longitude=float(lon),
        maximum_longitude=float(lon),
        minimum_latitude=float(lat),
        maximum_latitude=float(lat),
        start_datetime=start,
        end_datetime=end,
        coordinates_selection_method="nearest",
        service="timeseries",
    )


def has_valid_vhm0(df):
    if df is None or len(df) == 0:
        return False
    if "VHM0" not in df.columns:
        return False
    vals = pd.to_numeric(df["VHM0"], errors="coerce")
    return bool(((vals >= 0.0) & vals.notna()).any())


def get_wave_dataframe(lon, lat, start, end):
    """Return the historical wave time series for one route point.

    The Arctic route itself is independent from the wave-data source.  The
    Copernicus Arctic wave products are geographically appropriate north of
    63 N, but their current dataset entries do not expose the ``timeseries``
    service used by ``read_dataframe`` in this deployment (the API reports
    ``ServiceNotAvailable: Available services for dataset: []``).  Therefore
    the robust point-series path uses the global WAVERYS dataset for Arctic
    route points as well.  WAVERYS is explicitly global (-89.8 to 89.8 deg)
    and contains VHM0 and VMDR on the same 0.2 deg grid used elsewhere in the
    app.

    ``is_arctic`` is retained as a presentation/diagnostic flag so the UI can
    still distinguish Arctic route points and render their directional roses
    accordingly.  It does NOT change the routing geometry or the sampling.
    """
    is_arctic = float(lat) >= ARCTIC_THRESHOLD_LAT
    df = read_point_dataset(DATASET_ID, lon, lat, start, end)
    if is_arctic:
        return df, "Global WAVERYS — Arctic route point", True
    return df, "Global WAVERYS", False


def read_ice_dataset(dataset_id, lon, lat, start, end, variables):
    return copernicusmarine.read_dataframe(
        dataset_id=dataset_id,
        variables=variables,
        minimum_longitude=float(lon),
        maximum_longitude=float(lon),
        minimum_latitude=float(lat),
        maximum_latitude=float(lat),
        start_datetime=start,
        end_datetime=end,
        coordinates_selection_method="nearest",
        service="timeseries",
    )


def get_ice_status(lon, lat, start, end, season=None, month_filter=None):
    """Retrieve Arctic sea-ice concentration and thickness for a route point.

    Ice information is independent from wave-data availability and is returned
    whenever the point lies inside the Arctic ice-product domain.
    The Arctic sea-ice analysis/forecast dataset provides hourly siconc/sithick
    from Aug 2019 onward; the Arctic sea-ice reanalysis provides daily siconc
    from 1993 through May 2026. A 15% concentration threshold is used as the
    conventional ice-covered threshold.
    """
    result = {
        "ice_status": "not_checked",
        "ice_affected": False,
        "ice_source": None,
        "ice_observation_count": 0,
        "ice_covered_observation_count": 0,
        "ice_max_fraction": None,
        "ice_mean_fraction": None,
        "ice_error": None,
    }
    if float(lat) < ICE_MIN_LAT:
        result["ice_status"] = "outside_ice_product"
        return result

    frames = []
    errors = []
    # Prefer the current hourly Arctic sea-ice analysis/forecast where the
    # requested period overlaps it.
    if end >= ICE_NRT_START and start <= ICE_NRT_END:
        a = max(start, ICE_NRT_START)
        b = min(end, ICE_NRT_END)
        if a <= b:
            try:
                frames.append((read_ice_dataset(ICE_DATASET_ID, lon, lat, a, b, ["siconc", "sithick"]), "Arctic sea-ice analysis/forecast"))
            except Exception as exc:
                errors.append(f"analysis/forecast: {type(exc).__name__}: {exc}")

    # Fill historical periods not covered by the hourly product with the daily
    # multi-year sea-ice reanalysis.
    if end >= ICE_MY_START and start <= ICE_MY_END:
        a = max(start, ICE_MY_START)
        b = min(end, ICE_MY_END)
        if a <= b:
            try:
                frames.append((read_ice_dataset(ICE_REANALYSIS_DATASET_ID, lon, lat, a, b, ["siconc", "sithick"]), "Arctic sea-ice reanalysis"))
            except Exception as exc:
                errors.append(f"reanalysis: {type(exc).__name__}: {exc}")

    values = []
    thickness = []
    for df, source in frames:
        if df is None or len(df) == 0 or "siconc" not in df.columns:
            continue
        local = df.copy()
        selected_months = set(int(m) for m in (month_filter or []) if int(m) in range(1,13))
        if selected_months or season in (1, 2, 3, 4):
            try:
                if "time" in local.columns:
                    times = pd.to_datetime(local["time"], utc=True, errors="coerce")
                else:
                    idx = local.index
                    if isinstance(idx, pd.MultiIndex) and "time" in idx.names:
                        times = pd.Series(pd.to_datetime(idx.get_level_values("time"), utc=True, errors="coerce"), index=local.index)
                    else:
                        times = pd.Series(pd.to_datetime(idx, utc=True, errors="coerce"), index=local.index)
                months = selected_months if selected_months else {1:{12,1,2},2:{3,4,5},3:{6,7,8},4:{9,10,11}}[season]
                local = local.loc[times.dt.month.isin(months).to_numpy()]
            except Exception as exc:
                errors.append(f"season filter: {type(exc).__name__}: {exc}")
                continue
        for v in pd.to_numeric(local["siconc"], errors="coerce").tolist():
            try:
                x=float(v)
                if math.isfinite(x):
                    # Some NetCDF conventions expose concentration as percent;
                    # normalize that to a 0..1 fraction.
                    if x > 1.0 and x <= 100.0:
                        x /= 100.0
                    if 0.0 <= x <= 1.0:
                        values.append(x)
            except Exception:
                pass
        if "sithick" in local.columns:
            for v in pd.to_numeric(local["sithick"], errors="coerce").tolist():
                try:
                    x=float(v)
                    if math.isfinite(x) and x >= 0:
                        thickness.append(x)
                except Exception:
                    pass

    if values:
        covered=sum(1 for x in values if x >= ICE_THRESHOLD)
        result.update({
            "ice_status": "ice_affected" if covered else "no_ice_detected",
            "ice_affected": bool(covered),
            "ice_observation_count": len(values),
            "ice_covered_observation_count": covered,
            "ice_max_fraction": max(values),
            "ice_mean_fraction": sum(values)/len(values),
            "ice_source": " + ".join(sorted(set(src for _,src in frames))),
        })
        if thickness:
            result["ice_max_thickness_m"] = max(thickness)
            result["ice_mean_thickness_m"] = sum(thickness)/len(thickness)
        return result

    result["ice_status"] = "no_wave_data"
    if errors:
        result["ice_error"] = " | ".join(errors)[:1200]
    return result

def summarize_point(lon, lat, start, end, season, month_filter=None):
    is_arctic = float(lat) >= ARCTIC_THRESHOLD_LAT
    try:
        df, data_source, is_arctic = get_wave_dataframe(lon, lat, start, end)

        if df is None or len(df) == 0:
            ice = get_ice_status(lon, lat, start, end, season, month_filter) if is_arctic else {"ice_status":"not_checked","ice_affected":False}
            return {"lon": lon, "lat": lat, "count": 0, "data_source": data_source, "is_arctic": is_arctic, "error": "Copernicus returned an empty dataframe for the selected wave product.", **ice}

        # Optional meteorological season filter. IMPORTANT: the requested
        # historical interval is fetched first, then the same three UTC
        # calendar months are retained in EVERY year of that interval.
        # Example: 10 years + Season 1 means Dec/Jan/Feb for all 10 years.
        raw_count = len(df)
        season_name = "All seasons"
        months = None
        selected_months = set(int(m) for m in (month_filter or []) if int(m) in range(1,13))
        if selected_months:
            months = selected_months
            month_names = {1:"Jan",2:"Feb",3:"Mar",4:"Apr",5:"May",6:"Jun",7:"Jul",8:"Aug",9:"Sep",10:"Oct",11:"Nov",12:"Dec"}
            season_name = "Selected months — " + ", ".join(month_names[m] for m in sorted(months))
        elif season in (1, 2, 3, 4):
            month_map = {
                1: ({12, 1, 2}, "Season 1 — Dec / Jan / Feb"),
                2: ({3, 4, 5}, "Season 2 — Mar / Apr / May"),
                3: ({6, 7, 8}, "Season 3 — Jun / Jul / Aug"),
                4: ({9, 10, 11}, "Season 4 — Sep / Oct / Nov"),
            }
            months, season_name = month_map[season]

        # Apply the selected calendar months in exactly the same way whether
        # they came from a predefined season or from the manual month picker.
        # This keeps Season 1 and Dec+Jan+Feb mathematically identical.
        if months is not None:
            try:
                times = None
                if "time" in df.columns:
                    candidate = pd.to_datetime(df["time"], utc=True, errors="coerce")
                    if candidate.notna().any():
                        times = candidate

                if times is None:
                    idx = df.index
                    if isinstance(idx, pd.MultiIndex) and "time" in idx.names:
                        candidate = pd.to_datetime(idx.get_level_values("time"), utc=True, errors="coerce")
                    else:
                        candidate = pd.to_datetime(idx, utc=True, errors="coerce")
                    if candidate.notna().any():
                        times = pd.Series(candidate, index=df.index)

                if times is None:
                    raise ValueError("Could not identify a valid time coordinate in the Copernicus response.")

                if isinstance(times, pd.Series):
                    month_mask = times.dt.month.isin(months)
                else:
                    month_mask = pd.Series(times.month.isin(months), index=df.index)

                selected_count = int(month_mask.sum())
                if selected_count == 0:
                    return {
                        "lon": lon, "lat": lat, "count": 0, "raw_count": raw_count, "is_arctic": is_arctic,
                        "season_count": 0, "season": season if season in (1,2,3,4) else "all", "season_name": season_name,
                        "season_months": sorted(months),
                        "error": f"No observations in {season_name} within the requested historical period."
                    }

                df = df.loc[month_mask.to_numpy()]
            except Exception as exc:
                return {
                    "lon": lon, "lat": lat, "count": 0, "raw_count": raw_count, "is_arctic": is_arctic,
                    "season_count": 0, "season": season if season in (1,2,3,4) else "all", "season_name": season_name,
                    "season_months": sorted(months),
                    "error": f"Could not apply the calendar month filter: {type(exc).__name__}: {exc}"
                }

        filtered_count = len(df) if (selected_months or season in (1, 2, 3, 4)) else len(df)

        if "VHM0" in df.columns:
            series = df["VHM0"].copy()
        elif "value" in df.columns:
            series = df["value"].copy()
        else:
            numeric = [c for c in df.columns if c not in ("time", "latitude", "longitude", "depth")]
            if not numeric:
                return {"lon": lon, "lat": lat, "data_source": data_source, "is_arctic": is_arctic, "count": 0, "error": f"VHM0 column not found. Columns: {list(df.columns)}"}
            series = df[numeric[0]].copy()

        wave_series = df["VMDR"].copy() if "VMDR" in df.columns else None

        # Keep Hs and VMDR independent: a missing VMDR observation must not
        # discard an otherwise valid VHM0 value. This is particularly important
        # in Arctic points affected by sea-ice masking.
        vals = []
        wave_vals = []
        for h in series.tolist():
            try:
                hv = float(h)
                if math.isfinite(hv) and hv >= 0.0:
                    vals.append(hv)
            except Exception:
                pass
        if wave_series is not None:
            for w in wave_series.tolist():
                try:
                    wv = float(w)
                    if math.isfinite(wv) and 0.0 <= wv <= 360.0:
                        wave_vals.append(wv % 360.0)
                except Exception:
                    pass

        if not vals:
            ice = get_ice_status(lon, lat, start, end, season, month_filter) if is_arctic else {"ice_status":"not_checked","ice_affected":False}
            return {"lon": lon, "lat": lat, "data_source": data_source, "is_arctic": is_arctic, "count": 0, "error": "VHM0 contained no finite numeric values after the selected season filter.", **ice}

        result = {
            "lon": lon,
            "lat": lat,
            "data_source": data_source,
            "is_arctic": is_arctic,
            "count": len(vals),
            "raw_count": raw_count,
            "season_count": filtered_count,
            "season": season if season in (1, 2, 3, 4) else "all",
            "season_name": season_name,
            "season_months": sorted(months) if (selected_months or season in (1, 2, 3, 4)) else "all",
            "mean": sum(vals) / len(vals),
            "median": percentile(vals, 0.50),
            "max": max(vals),
            "p95": percentile(vals, 0.95),
            "p99": percentile(vals, 0.99),
        }

        # VMDR is circular. Copernicus defines it as the direction waves come
        # FROM, clockwise from True North. Use a circular mean, not an
        # arithmetic mean, so 359° and 1° correctly average to ~0°.
        if wave_vals:
            sin_mean = sum(math.sin(math.radians(v)) for v in wave_vals) / len(wave_vals)
            cos_mean = sum(math.cos(math.radians(v)) for v in wave_vals) / len(wave_vals)
            wave_from = math.degrees(math.atan2(sin_mean, cos_mean)) % 360.0
            result["wave_from_deg"] = wave_from
            result["wave_direction_count"] = len(wave_vals)

            # Directional distribution of VMDR (direction waves come FROM).
            # 16 compass sectors, 22.5° each, centered on N, NNE, NE, ... NNW.
            # Return counts rather than all individual observations to keep the
            # browser response compact while preserving the historical distribution.
            bins = [0] * 16
            # Directional rose split by significant wave height. Each sector
            # is radial in proportion to its observation frequency, while the
            # radial stack shows the Hs classes within that direction.
            # Hs classes: 0-1, 1-2, 2-3, 3-4, 4-5, >5 m.
            hs_direction_bins = [[0] * 6 for _ in range(16)]
            try:
                hs_vals = pd.to_numeric(series, errors="coerce").tolist()
            except Exception:
                hs_vals = []
            for direction, hs in zip(wave_series.tolist() if wave_series is not None else [], hs_vals):
                try:
                    d = float(direction); h = float(hs)
                    if not (math.isfinite(d) and 0.0 <= d <= 360.0 and math.isfinite(h) and h >= 0.0):
                        continue
                    idx = int(((d % 360.0) + 11.25) // 22.5) % 16
                    bins[idx] += 1
                    hidx = 0 if h < 1.0 else 1 if h < 2.0 else 2 if h < 3.0 else 3 if h < 4.0 else 4 if h < 5.0 else 5
                    hs_direction_bins[idx][hidx] += 1
                except Exception:
                    pass
            result["wave_direction_bins"] = bins
            result["wave_direction_hs_bins"] = hs_direction_bins
        else:
            result["wave_from_deg"] = None
            result["wave_direction_count"] = 0
            result["wave_direction_bins"] = [0] * 16

        # Retrieve ice information independently of wave-data availability.
        ice = get_ice_status(lon, lat, start, end, season, month_filter) if is_arctic else {"ice_status":"not_checked","ice_affected":False}
        result.update(ice)
        return result
    except Exception as exc:
        return {"lon": lon, "lat": lat, "count": 0, "error": f"{type(exc).__name__}: {exc}"}

class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if self.path.split("?")[0] == "/api/health":
            configured = bool(os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME") and os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD"))
            self._send(200, {"ok": True, "dataset": DATASET_ID, "variables": VARIABLES, "credentials_configured": configured})
            return
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/api/hs":
            self._send(404, {"error": "Not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(n).decode("utf-8"))
            points = payload.get("points")
            if points is None and "lon" in payload and "lat" in payload:
                points = [{"lon": payload["lon"], "lat": payload["lat"]}]
            if not isinstance(points, list) or not points:
                raise ValueError("No route points supplied.")
            if len(points) > MAX_POINTS:
                raise ValueError(f"Too many route points. Maximum is {MAX_POINTS}.")
            start = datetime.fromisoformat(payload["start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(payload["end"].replace("Z", "+00:00"))
            season_raw = payload.get("season", "all")
            season = None if season_raw in (None, "", "all") else int(season_raw)
            if season not in (None, 1, 2, 3, 4):
                raise ValueError("Season must be all, 1, 2, 3, or 4.")
            month_filter = payload.get("months", []) or []
            if not isinstance(month_filter, list):
                raise ValueError("Months must be a list of calendar month numbers.")
            month_filter = sorted(set(int(m) for m in month_filter))
            if any(m < 1 or m > 12 for m in month_filter):
                raise ValueError("Month numbers must be between 1 and 12.")
            if month_filter:
                season = None
            if end <= start:
                raise ValueError("End date must be after start date.")
            if not os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME") or not os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD"):
                raise RuntimeError("Copernicus credentials are not configured on the web app. Add COPERNICUSMARINE_SERVICE_USERNAME and COPERNICUSMARINE_SERVICE_PASSWORD in Vercel Environment Variables.")

            results = [None] * len(points)
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
                futures = {pool.submit(summarize_point, float(p["lon"]), float(p["lat"]), start, end, season, month_filter): i for i, p in enumerate(points)}
                for future in as_completed(futures):
                    results[futures[future]] = future.result()

            failures = [r for r in results if not r or not math.isfinite(float(r.get("mean", float("nan"))))]
            self._send(200, {"dataset": DATASET_ID, "variables": VARIABLES, "season": season if season is not None else "all", "months": month_filter, "points": results, "valid_points": len(results) - len(failures), "failed_points": len(failures)})
        except Exception as e:
            self._send(502, {"error": str(e)})

    def log_message(self, fmt, *args):
        return
