import json
import math
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

import copernicusmarine

DATASET_ID = "cmems_mod_glo_wav_my_0.2deg_PT3H-i"
VARIABLE = "VHM0"
MAX_POINTS = 24
MAX_WORKERS = 4

def iso(v):
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v=v.replace(tzinfo=timezone.utc)
        return v.isoformat()
    return str(v)

def percentile(values, q):
    if not values:
        return float("nan")
    xs=sorted(values)
    if len(xs)==1:
        return xs[0]
    k=(len(xs)-1)*q
    f=math.floor(k)
    c=math.ceil(k)
    if f==c:
        return xs[int(k)]
    return xs[f]+(xs[c]-xs[f])*(k-f)

def summarize_point(lon, lat, start, end):
    # ARCO Time Series is the Copernicus service optimized for long
    # time-series at a small geographic area.
    df=copernicusmarine.read_dataframe(
        dataset_id=DATASET_ID,
        variables=[VARIABLE],
        minimum_longitude=float(lon),
        maximum_longitude=float(lon),
        minimum_latitude=float(lat),
        maximum_latitude=float(lat),
        start_datetime=start,
        end_datetime=end,
        coordinates_selection_method="nearest",
        service="timeseries",
    )

    if df is None or len(df)==0:
        return {"lon":lon,"lat":lat,"samples":[]}

    # Depending on the Toolbox version, the variable can be a named column
    # or a generic 'value' column. Handle both.
    if VARIABLE in df.columns:
        series=df[VARIABLE]
    elif "value" in df.columns:
        series=df["value"]
    else:
        numeric=[c for c in df.columns if c not in ("time","latitude","longitude","depth")]
        if not numeric:
            return {"lon":lon,"lat":lat,"samples":[]}
        series=df[numeric[0]]

    vals=[]
    for x in series.tolist():
        try:
            v=float(x)
            if math.isfinite(v):
                vals.append(v)
        except Exception:
            pass

    if not vals:
        return {"lon":lon,"lat":lat,"samples":[]}

    # Return a compact representative series for diagnostics/optional charting.
    # Statistics are calculated from the full 3-hourly dataset.
    max_series=1000
    step=max(1,math.ceil(len(vals)/max_series))
    samples=[{"hs":v} for v in vals[::step]]

    return {
        "lon":lon,
        "lat":lat,
        "samples":samples,
        "count":len(vals),
        "mean":sum(vals)/len(vals),
        "median":percentile(vals,0.50),
        "max":max(vals),
        "p95":percentile(vals,0.95),
        "p99":percentile(vals,0.99),
    }

class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body=json.dumps(payload,separators=(",",":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Cache-Control","no-store")
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Headers","Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204,{})

    def do_GET(self):
        if self.path.split("?")[0] == "/api/health":
            configured=bool(
                os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME") and
                os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD")
            )
            self._send(200,{
                "ok":True,
                "dataset":DATASET_ID,
                "variable":VARIABLE,
                "credentials_configured":configured
            })
            return
        self._send(404,{"error":"Not found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/api/hs":
            self._send(404,{"error":"Not found"})
            return

        try:
            n=int(self.headers.get("Content-Length","0"))
            payload=json.loads(self.rfile.read(n).decode("utf-8"))

            points=payload.get("points")
            # V3 accepts the frontend's single-point request as well.
            if points is None and "lon" in payload and "lat" in payload:
                points=[{"lon":payload["lon"],"lat":payload["lat"]}]
            if not isinstance(points,list) or not points:
                raise ValueError("No route points supplied.")
            if len(points)>MAX_POINTS:
                raise ValueError(f"Too many route points. Maximum is {MAX_POINTS}.")

            start=datetime.fromisoformat(payload["start"].replace("Z","+00:00"))
            end=datetime.fromisoformat(payload["end"].replace("Z","+00:00"))
            if end<=start:
                raise ValueError("End date must be after start date.")

            username=os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME")
            password=os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD")
            if not username or not password:
                raise RuntimeError(
                    "Copernicus credentials are not configured on the web app. "
                    "Add COPERNICUSMARINE_SERVICE_USERNAME and "
                    "COPERNICUSMARINE_SERVICE_PASSWORD in Vercel Environment Variables."
                )

            # copernicusmarine reads the standard environment variables.
            results=[None]*len(points)
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
                futures={
                    pool.submit(
                        summarize_point,
                        float(p["lon"]),
                        float(p["lat"]),
                        start,
                        end
                    ):i
                    for i,p in enumerate(points)
                }
                for future in as_completed(futures):
                    i=futures[future]
                    results[i]=future.result()

            # Return point summaries in the same order as the route.
            self._send(200,{
                "dataset":DATASET_ID,
                "variable":VARIABLE,
                "points":results
            })

        except Exception as e:
            self._send(502,{"error":str(e)})

    def log_message(self, fmt, *args):
        # Keep Vercel logs compact.
        return
