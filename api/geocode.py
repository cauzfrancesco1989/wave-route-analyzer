import json
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

PHOTON_URL = "https://photon.komoot.io/api"
_last_request = 0.0


def photon_search(q, limit=12):
    global _last_request
    wait = 1.0 - (time.time() - _last_request)
    if wait > 0:
        time.sleep(wait)
    params = urllib.parse.urlencode({"q": q, "limit": limit, "lang": "en", "dedupe": 1})
    req = urllib.request.Request(
        f"{PHOTON_URL}?{params}",
        headers={"User-Agent": "Wave-Route-Analyzer/3.25 (+https://wave-route-analyzer.vercel.app)"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=12) as response:
        data = json.loads(response.read().decode("utf-8"))
    _last_request = time.time()
    return data


def _norm(v):
    return str(v or "").strip().lower()


def rank_feature(f, q, query_variant=""):
    p = f.get("properties", {}) or {}
    name = _norm(p.get("name"))
    label = _norm(p.get("label"))
    query = _norm(q)
    osm_key = _norm(p.get("osm_key"))
    osm_value = _norm(p.get("osm_value"))
    kind = f"{osm_key}:{osm_value}"
    score = 0

    # Exact/strong name matches first.
    if name == query:
        score += 1200
    elif query and query in name:
        score += 600
    elif query and query in label:
        score += 300

    # Prefer actual marine facilities over generic city/country results.
    marine_values = {"harbour", "harbor", "port", "marina", "pier", "dock", "quay", "waterway"}
    if osm_value in marine_values:
        score += 900
    if osm_key in {"harbour", "waterway"} and osm_value in marine_values:
        score += 250
    if osm_key == "place" and osm_value in {"city", "town", "village"}:
        score += 80

    # The targeted query variants should strongly favour marine results.
    if query_variant in {"port", "harbour"} and osm_value in marine_values:
        score += 500

    # Explicitly penalise airports and other non-marine transport features.
    if osm_value in {"aerodrome", "airport", "bus_station", "railway"} or osm_key in {"aeroway", "railway"}:
        score -= 1200
    return score


def merge_features(feature_lists, q):
    seen = set()
    merged = []
    for variant, features in feature_lists:
        for f in features or []:
            p = f.get("properties", {}) or {}
            coords = tuple(f.get("geometry", {}).get("coordinates", []) or [])
            key = (p.get("osm_type"), p.get("osm_id"), coords)
            if key in seen:
                continue
            seen.add(key)
            merged.append((rank_feature(f, q, variant), f))
    merged.sort(key=lambda x: x[0], reverse=True)
    return [f for _, f in merged]


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "public, max-age=300")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            q = (params.get("q") or [""])[0].strip()
            if len(q) < 2:
                return self._send(400, {"error": "Search query is too short."})

            # Always query the generic place name plus explicit marine variants.
            # This avoids returning an airport/city result merely because the
            # generic Photon response happened to contain the substring "port".
            feature_lists = []
            for variant, query_variant in (("", q), ("port", f"{q} port"), ("harbour", f"{q} harbour")):
                try:
                    data = photon_search(query_variant, 8)
                    feature_lists.append((variant, data.get("features", []) or []))
                except Exception:
                    # One failed provider query should not make the whole search fail.
                    continue

            features = merge_features(feature_lists, q)
            return self._send(200, {"features": features[:12], "provider": "Photon / OpenStreetMap", "search_mode": "place + port + harbour"})
        except Exception as exc:
            return self._send(502, {"error": f"Location search failed: {exc}"})
