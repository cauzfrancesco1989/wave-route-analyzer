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
        headers={"User-Agent": "Wave-Route-Analyzer/3.24"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=12) as response:
        data = json.loads(response.read().decode("utf-8"))
    _last_request = time.time()
    return data


def rank_feature(f, q):
    p = f.get("properties", {}) or {}
    name = str(p.get("name", "")).lower()
    query = q.lower().strip()
    osm_key = str(p.get("osm_key", "")).lower()
    osm_value = str(p.get("osm_value", "")).lower()
    text = f"{name} {osm_key} {osm_value}".lower()
    score = 0
    if name == query:
        score += 1000
    elif query and query in name:
        score += 500
    # Prefer actual port/harbour/marina features when the user searches a
    # coastal location, while still allowing a normal coastal city result.
    if any(k in text for k in ("harbour", "harbor", "port", "marina", "pier", "dock")):
        score += 250
    if osm_key in ("amenity", "harbour", "man_made"):
        score += 50
    if osm_value in ("harbour", "port", "marina", "pier", "dock"):
        score += 150
    return score


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

            data = photon_search(q, 12)
            features = data.get("features", []) or []
            features.sort(key=lambda f: rank_feature(f, q), reverse=True)

            # If the generic query produced no port-like result, make one
            # restrained second query targeted at ports/harbours.
            text = json.dumps(features).lower()
            if features and not any(k in text for k in ("harbour", "harbor", "port", "marina")):
                try:
                    port_data = photon_search(f"{q} port", 8)
                    port_features = port_data.get("features", []) or []
                    features.extend(port_features)
                    seen = set()
                    unique = []
                    for f in features:
                        p = f.get("properties", {}) or {}
                        key = (p.get("osm_type"), p.get("osm_id"), f.get("geometry", {}).get("coordinates"))
                        if key in seen:
                            continue
                        seen.add(key)
                        unique.append(f)
                    features = sorted(unique, key=lambda f: rank_feature(f, q), reverse=True)
                except Exception:
                    pass

            return self._send(200, {"features": features[:12], "provider": "Photon / OpenStreetMap"})
        except Exception as exc:
            return self._send(502, {"error": f"Location search failed: {exc}"})
