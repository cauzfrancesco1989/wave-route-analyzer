import json
import math
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

import copernicusmarine
import pandas as pd

DATASET_ID = "cmems_mod_glo_wav_my_0.2deg_PT3H-i"
VARIABLES = ["VHM0", "VMDR"]
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

def summarize_point(lon, lat, start, end, season):
    try:
        df = copernicusmarine.read_dataframe(
            dataset_id=DATASET_ID,
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

        if df is None or len(df) == 0:
            return {"lon": lon, "lat": lat, "count": 0, "error": "Copernicus returned an empty dataframe."}

        # Optional meteorological season filter. IMPORTANT: the requested
        # historical interval is fetched first, then the same three UTC
        # calendar months are retained in EVERY year of that interval.
        # Example: 10 years + Season 1 means Dec/Jan/Feb for all 10 years.
        raw_count = len(df)
        season_name = "All seasons"
        months = None
        if season in (1, 2, 3, 4):
            month_map = {
                1: ({12, 1, 2}, "Season 1 — Dec / Jan / Feb"),
                2: ({3, 4, 5}, "Season 2 — Mar / Apr / May"),
                3: ({6, 7, 8}, "Season 3 — Jun / Jul / Aug"),
                4: ({9, 10, 11}, "Season 4 — Sep / Oct / Nov"),
            }
            months, season_name = month_map[season]
            try:
                # Copernicus may expose time either as a normal column, a
                # DatetimeIndex, or a MultiIndex level. Resolve that explicitly
                # and NEVER silently continue without applying the month filter.
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
                        "lon": lon, "lat": lat, "count": 0, "raw_count": raw_count,
                        "season_count": 0, "season": season, "season_name": season_name,
                        "season_months": sorted(months),
                        "error": f"No observations in {season_name} within the requested historical period."
                    }

                # Filter the dataframe itself so VHM0 and VMDR remain perfectly aligned.
                df = df.loc[month_mask.to_numpy()]
            except Exception as exc:
                return {
                    "lon": lon, "lat": lat, "count": 0, "raw_count": raw_count,
                    "season_count": 0, "season": season, "season_name": season_name,
                    "season_months": sorted(months),
                    "error": f"Could not apply the seasonal month filter: {type(exc).__name__}: {exc}"
                }

        filtered_count = len(df) if season in (1, 2, 3, 4) else len(df)

        if "VHM0" in df.columns:
            series = df["VHM0"].copy()
        elif "value" in df.columns:
            series = df["value"].copy()
        else:
            numeric = [c for c in df.columns if c not in ("time", "latitude", "longitude", "depth")]
            if not numeric:
                return {"lon": lon, "lat": lat, "count": 0, "error": f"VHM0 column not found. Columns: {list(df.columns)}"}
            series = df[numeric[0]].copy()

        wave_series = df["VMDR"].copy() if "VMDR" in df.columns else None

        # Keep only finite Hs values. VMDR is kept aligned with the same rows.
        vals = []
        wave_vals = []
        if wave_series is not None:
            for h, w in zip(series.tolist(), wave_series.tolist()):
                try:
                    hv = float(h)
                    wv = float(w)
                    if math.isfinite(hv) and math.isfinite(wv) and 0.0 <= wv <= 360.0:
                        vals.append(hv)
                        wave_vals.append(wv % 360.0)
                except Exception:
                    pass
        else:
            for x in series.tolist():
                try:
                    v = float(x)
                    if math.isfinite(v):
                        vals.append(v)
                except Exception:
                    pass

        if not vals:
            return {"lon": lon, "lat": lat, "count": 0, "error": "VHM0 contained no finite numeric values after the selected season filter."}

        result = {
            "lon": lon,
            "lat": lat,
            "count": len(vals),
            "raw_count": raw_count,
            "season_count": filtered_count,
            "season": season if season in (1, 2, 3, 4) else "all",
            "season_name": season_name,
            "season_months": sorted(months) if season in (1, 2, 3, 4) else "all",
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
            for direction in wave_vals:
                idx = int(((direction + 11.25) % 360.0) // 22.5)
                bins[idx] += 1
            result["wave_direction_bins"] = bins
        else:
            result["wave_from_deg"] = None
            result["wave_direction_count"] = 0
            result["wave_direction_bins"] = [0] * 16

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
            if end <= start:
                raise ValueError("End date must be after start date.")
            if not os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME") or not os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD"):
                raise RuntimeError("Copernicus credentials are not configured on the web app. Add COPERNICUSMARINE_SERVICE_USERNAME and COPERNICUSMARINE_SERVICE_PASSWORD in Vercel Environment Variables.")

            results = [None] * len(points)
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
                futures = {pool.submit(summarize_point, float(p["lon"]), float(p["lat"]), start, end, season): i for i, p in enumerate(points)}
                for future in as_completed(futures):
                    results[futures[future]] = future.result()

            failures = [r for r in results if not r or not math.isfinite(float(r.get("mean", float("nan"))))]
            self._send(200, {"dataset": DATASET_ID, "variables": VARIABLES, "season": season if season is not None else "all", "points": results, "valid_points": len(results) - len(failures), "failed_points": len(failures)})
        except Exception as e:
            self._send(502, {"error": str(e)})

    def log_message(self, fmt, *args):
        return
