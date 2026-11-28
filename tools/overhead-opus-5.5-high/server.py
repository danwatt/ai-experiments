#!/usr/bin/env python3
"""Overhead — tiny stdlib backend.

Serves the static front end and proxies open ADS-B data providers, which do not
send CORS headers. Responses are normalized to one shape and cached briefly so
many browser tabs share one upstream request (and respect provider rate limits).

    python3 server.py [port]                       # this machine only (localhost)
    python3 server.py --host 0.0.0.0               # reachable from your network
    python3 server.py --host 0.0.0.0 --https       # ditto, with a self-signed certificate

Browsers only allow location and compass access on https:// or localhost, so use
--https when opening the app from a phone or tablet.

Optional env for OpenSky (raises anonymous 400 credits/day to 4000):
    OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET
"""

import argparse
import ipaddress
import json
import math
import os
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import airports
from heat import Heat

ROOT = os.path.dirname(os.path.abspath(__file__))
UA = "overhead-experiment/0.1 (personal, non-commercial)"
KT_PER_MS = 1.943844
FT_PER_M = 3.280839895

# Minimum seconds between upstream calls per cache key. adsb.lol / adsb.fi
# refresh about once per second; anonymous OpenSky only every 10 s and has a
# daily credit budget, so poll it gently.
PROVIDERS = {
    # adsb.lol anonymous limits: 60 req/min and 500 req/day per IP
    "adsblol": {"name": "adsb.lol", "license": "ODbL 1.0", "min_interval": 5.0,
                "url": "https://adsb.lol", "max_radius": 250},
    "adsbfi": {"name": "adsb.fi", "license": "open data, non-commercial", "min_interval": 1.1,
               "url": "https://adsb.fi", "max_radius": 250},
    "opensky": {"name": "OpenSky Network", "license": "OpenSky terms, non-commercial",
                "min_interval": 15.0, "url": "https://opensky-network.org", "max_radius": 150},
}

_cache = {}
_cache_lock = threading.Lock()
_key_locks = {}
_token = {"value": None, "exp": 0.0}
_backoff = {}  # provider -> {"until": epoch, "step": seconds}
HEAT = Heat(os.path.join(ROOT, "data", "heat.sqlite"))


def fetch_json(url, headers=None, data=None, timeout=12):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8")), dict(r.headers)


def clean(v):
    return v.strip() if isinstance(v, str) and v.strip() else None


def norm_readsb(ac, now):
    """readsb / tar1090 JSON (adsb.lol, adsb.fi)."""
    lat, lon = ac.get("lat"), ac.get("lon")
    seen_pos = ac.get("seen_pos")
    if lat is None or lon is None:
        # MLAT/TIS-B entries sometimes carry only lastPosition
        lp = ac.get("lastPosition") or {}
        lat, lon, seen_pos = lp.get("lat"), lp.get("lon"), lp.get("seen_pos")
    if lat is None or lon is None:
        return None
    alt = ac.get("alt_baro")
    ground = alt == "ground"
    return {
        "hex": ac.get("hex", "").lstrip("~").lower(),
        "flight": clean(ac.get("flight")),
        "reg": clean(ac.get("r")),
        "type": clean(ac.get("t")),
        "desc": clean(ac.get("desc")),
        "owner": clean(ac.get("ownOp")),
        "year": clean(ac.get("year")),
        "cat": clean(ac.get("category")),
        "mil": bool((ac.get("dbFlags") or 0) & 1),
        # owner asked for limited display (LADD) or uses a privacy address (PIA)
        "limited": bool((ac.get("dbFlags") or 0) & 0b1100),
        "lat": lat,
        "lon": lon,
        "alt": 0 if ground else (alt if isinstance(alt, (int, float)) else ac.get("alt_geom")),
        "altGeom": ac.get("alt_geom"),
        "ground": ground,
        "gs": ac.get("gs"),
        "track": ac.get("track", ac.get("true_heading", ac.get("mag_heading"))),
        "vrate": ac.get("baro_rate", ac.get("geom_rate")),
        "squawk": clean(ac.get("squawk")),
        "emergency": clean(ac.get("emergency")) if ac.get("emergency") not in (None, "none") else None,
        "src": ac.get("type"),
        "navAlt": ac.get("nav_altitude_mcp") or ac.get("nav_altitude_fms"),
        "rssi": ac.get("rssi"),
        "posTime": now - (seen_pos or 0),
    }


OPENSKY_CATS = {2: "A1", 3: "A2", 4: "A3", 5: "A4", 6: "A5", 7: "A6", 8: "A7", 9: "B1", 10: "B2",
                11: "B3", 12: "B4", 14: "B6", 15: "B7", 16: "C1", 17: "C2", 18: "C3", 19: "C3", 20: "C3"}


def norm_opensky(s):
    # https://openskynetwork.github.io/opensky-api/rest.html#all-state-vectors
    if s[5] is None or s[6] is None:
        return None
    alt_m = s[7] if s[7] is not None else s[13]
    return {
        "hex": s[0].lower(),
        "flight": clean(s[1]),
        "reg": None, "type": None, "desc": None, "owner": None, "year": None,
        "origin": s[2],
        "cat": OPENSKY_CATS.get(s[17]) if len(s) > 17 else None,
        "mil": False,
        "lat": s[6],
        "lon": s[5],
        "alt": 0 if s[8] else (round(alt_m * FT_PER_M) if alt_m is not None else None),
        "altGeom": round(s[13] * FT_PER_M) if s[13] is not None else None,
        "ground": bool(s[8]),
        "gs": round(s[9] * KT_PER_MS, 1) if s[9] is not None else None,
        "track": s[10],
        "vrate": round(s[11] * FT_PER_M * 60) if s[11] is not None else None,
        "squawk": clean(s[14]),
        "emergency": None,
        "src": "opensky",
        "navAlt": None,
        "rssi": None,
        "posTime": s[3],
    }


def opensky_token():
    cid, secret = os.environ.get("OPENSKY_CLIENT_ID"), os.environ.get("OPENSKY_CLIENT_SECRET")
    if not cid or not secret:
        return None
    if _token["value"] and time.time() < _token["exp"] - 60:
        return _token["value"]
    body = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": cid, "client_secret": secret}).encode()
    data, _ = fetch_json(
        "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
        headers={"Content-Type": "application/x-www-form-urlencoded"}, data=body)
    _token.update(value=data["access_token"], exp=time.time() + data.get("expires_in", 1800))
    return _token["value"]


def upstream(provider, lat, lon, radius):
    if provider == "adsblol":
        data, _ = fetch_json(f"https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}")
        now = data.get("now", time.time() * 1000) / 1000
        return now, [a for a in (norm_readsb(x, now) for x in data.get("ac") or []) if a]
    if provider == "adsbfi":
        data, _ = fetch_json(f"https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{radius}")
        now = data.get("now", time.time())
        return now, [a for a in (norm_readsb(x, now) for x in data.get("aircraft") or data.get("ac") or []) if a]
    if provider == "opensky":
        dlat = radius / 60.0
        dlon = radius / (60.0 * max(0.2, math.cos(math.radians(lat))))
        q = urllib.parse.urlencode({"lamin": lat - dlat, "lamax": lat + dlat, "lomin": lon - dlon,
                                    "lomax": lon + dlon, "extended": 1})
        tok = opensky_token()
        data, _ = fetch_json(f"https://opensky-network.org/api/states/all?{q}",
                             headers={"Authorization": f"Bearer {tok}"} if tok else None)
        now = data.get("time") or time.time()
        return now, [a for a in (norm_opensky(s) for s in data.get("states") or []) if a]
    raise ValueError("unknown provider")


def get_aircraft(provider, lat, lon, radius):
    cfg = PROVIDERS[provider]
    key = (provider, round(lat, 2), round(lon, 2), radius)
    with _cache_lock:
        lock = _key_locks.setdefault(key, threading.Lock())
    with lock:  # one in-flight upstream request per key
        hit = _cache.get(key)
        if hit and time.time() - hit["fetched"] < cfg["min_interval"]:
            return hit["body"]
        bo = _backoff.get(provider)
        if bo and time.time() < bo["until"]:
            err = f"{cfg['name']} rate limited — retrying in {int(bo['until'] - time.time()) + 1}s"
            return dict(hit["body"], ok=False, error=err, stale=True) if hit else \
                {"ok": False, "provider": provider, "error": err, "aircraft": [], "now": time.time(), "interval": cfg["min_interval"]}
        try:
            now, ac = upstream(provider, key[1], key[2], radius)
            body = {"ok": True, "provider": provider, "providerName": cfg["name"], "license": cfg["license"],
                    "providerUrl": cfg["url"], "now": now, "interval": cfg["min_interval"],
                    "authenticated": provider == "opensky" and bool(_token["value"]), "aircraft": ac}
            _cache[key] = {"fetched": time.time(), "body": body}
            _backoff.pop(provider, None)
            try:
                HEAT.record(ac)
            except Exception as e:  # history is a nice-to-have; never break the feed
                print("heat record failed:", e, file=sys.stderr)
            return body
        except urllib.error.HTTPError as e:
            err = f"{cfg['name']} returned HTTP {e.code}"
            if e.code == 429:
                step = min(120, (bo or {}).get("step", 5) * 2)
                try:
                    step = max(step, int(e.headers.get("Retry-After", 0)))
                except ValueError:
                    pass
                _backoff[provider] = {"until": time.time() + step, "step": step}
                err = f"{cfg['name']} rate limited — backing off {step}s"
        except Exception as e:  # network, JSON, timeouts
            err = f"{cfg['name']}: {e}"
        if hit:  # serve stale rather than nothing; client keeps interpolating
            stale = dict(hit["body"], ok=False, error=err, stale=True)
            hit["fetched"] = time.time()  # back off for one interval
            return stale
        return {"ok": False, "provider": provider, "error": err, "aircraft": [], "now": time.time(), "interval": cfg["min_interval"]}


# ---------------------------------------------------------------- routes
# ADS-B carries no flight plan, so origin/destination come from community
# callsign -> route databases. These are schedules, not today's filing; the
# client checks each candidate against the aircraft's position and motion.

ROUTE_TTL_HIT = 12 * 3600
ROUTE_TTL_MISS = 3 * 3600
ROUTE_TTL_ERR = 300
_routes = {}  # callsign -> {"exp": epoch, "body": {...}}
_routes_lock = threading.Lock()
_route_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="routes")


def _airport(icao, iata, name, city, country, lat, lon, elev):
    return {"icao": icao, "iata": iata, "name": name, "city": city, "country": country,
            "lat": lat, "lon": lon, "elevFt": elev}


def route_adsbdb(cs):
    """https://www.adsbdb.com — origin, optional midpoint, destination."""
    try:
        data, _ = fetch_json(f"https://api.adsbdb.com/v0/callsign/{cs}", timeout=8)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    fr = data.get("response")
    fr = fr.get("flightroute") if isinstance(fr, dict) else None
    if not fr:
        return None
    legs = [fr.get(k) for k in ("origin", "midpoint", "destination")]
    airports = [_airport(a.get("icao_code"), a.get("iata_code"), a.get("name"), a.get("municipality"),
                         a.get("country_iso_name"), a.get("latitude"), a.get("longitude"), a.get("elevation"))
                for a in legs if a]
    return {"source": "adsbdb", "airports": airports} if len(airports) >= 2 else None


def route_vrs(cs):
    """adsb.lol mirror of the Virtual Radar Server standing data; may list several legs."""
    try:
        data, _ = fetch_json(f"https://vrs-standing-data.adsb.lol/routes/{cs[:2]}/{cs}.json", timeout=8)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    known = {a.get("icao"): a for a in data.get("_airports") or []}
    airports = []
    for code in (data.get("airport_codes") or "").split("-"):
        a = known.get(code)
        if a:
            airports.append(_airport(a.get("icao"), a.get("iata"), a.get("name"), a.get("location"),
                                     a.get("countryiso2"), a.get("lat"), a.get("lon"), a.get("alt_feet")))
    return {"source": "adsb.lol", "airports": airports} if len(airports) >= 2 else None


def lookup_route(cs):
    with _routes_lock:
        hit = _routes.get(cs)
        if hit and time.time() < hit["exp"]:
            return hit["body"]
    candidates, errors = [], 0
    for fn in (route_adsbdb, route_vrs):
        try:
            r = fn(cs)
            if r:
                candidates.append(r)
        except Exception:  # network / JSON / 429 — try again later
            errors += 1
    if candidates:
        body, ttl = {"status": "ok", "candidates": candidates}, ROUTE_TTL_HIT
    elif errors:
        body, ttl = {"status": "error"}, ROUTE_TTL_ERR
    else:
        body, ttl = {"status": "none"}, ROUTE_TTL_MISS
    with _routes_lock:
        _routes[cs] = {"exp": time.time() + ttl, "body": body}
    return body


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/aircraft"):
            super().log_message(fmt, *args)

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, obj, status=200):
        raw = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path.startswith("/data/"):  # downloaded CSVs and the history database stay private
            return self.send_error(404)
        if url.path == "/api/providers":
            return self.send_json({k: {kk: vv for kk, vv in v.items()} for k, v in PROVIDERS.items()})
        if url.path in ("/api/airports", "/api/heat"):
            q = urllib.parse.parse_qs(url.query)
            try:
                lat, lon = float(q["lat"][0]), float(q["lon"][0])
                radius = max(5.0, min(250.0, float(q.get("radius", ["40"])[0])))
                if url.path == "/api/airports":
                    return self.send_json({"airports": airports.near(lat, lon, radius, UA)})
                hours = float(q.get("hours", ["24"])[0])  # 0 = all time
                bands = [int(b) for b in q.get("bands", ["0,1,2,3,4"])[0].split(",") if b.strip().isdigit()]
                return self.send_json(HEAT.query(lat, lon, radius, hours, bands))
            except (KeyError, ValueError, IndexError):
                return self.send_json({"error": "bad parameters"}, 400)
            except Exception as e:  # e.g. OurAirports download failed with no cached copy
                return self.send_json({"error": str(e)}, 502)
        if url.path == "/api/routes":
            q = urllib.parse.parse_qs(url.query)
            raw = (q.get("callsigns") or [""])[0].upper().split(",")
            cs = [c for c in dict.fromkeys(x.strip() for x in raw) if c.isalnum() and 3 <= len(c) <= 8][:30]
            results = dict(zip(cs, _route_pool.map(lookup_route, cs)))
            return self.send_json({"routes": results})
        if url.path == "/api/aircraft":
            q = urllib.parse.parse_qs(url.query)
            try:
                provider = q.get("provider", ["adsblol"])[0]
                lat, lon = float(q["lat"][0]), float(q["lon"][0])
                cfg = PROVIDERS[provider]
                radius = int(max(5, min(cfg["max_radius"], float(q.get("radius", ["40"])[0]))))
                if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                    raise ValueError
            except (KeyError, ValueError, IndexError):
                return self.send_json({"ok": False, "error": "bad parameters"}, 400)
            return self.send_json(get_aircraft(provider, lat, lon, radius))
        return super().do_GET()


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Untrusted self-signed certificates, plain http to the https port and dropped
        # connections are routine on a shared network; don't print a traceback for each.
        err = sys.exc_info()[1]
        if isinstance(err, (ssl.SSLError, ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def lan_addresses():
    """This machine's addresses other devices can reach (best effort, no packets sent)."""
    found = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))  # TEST-NET; connecting a UDP socket only picks a route
            found.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            found.add(ip)
    except OSError:
        pass
    return sorted(ip for ip in found if not ipaddress.ip_address(ip).is_loopback)


def self_signed(names, ips):
    """Create (once) a self-signed certificate for this machine's names and addresses."""
    cert, key = os.path.join(ROOT, "data", "selfsigned.crt"), os.path.join(ROOT, "data", "selfsigned.key")
    want = sorted({f"DNS:{n}" for n in names} | {f"IP:{i}" for i in ips})
    marker = cert + ".san"
    if os.path.exists(cert) and os.path.exists(key) and os.path.exists(marker) and open(marker).read() == ",".join(want):
        return cert, key
    os.makedirs(os.path.dirname(cert), exist_ok=True)
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
                    "-keyout", key, "-out", cert, "-subj", "/CN=Overhead (self-signed)",
                    "-addext", "subjectAltName=" + ",".join(want)],
                   check=True, capture_output=True)
    os.chmod(key, 0o600)
    with open(marker, "w") as f:
        f.write(",".join(want))
    return cert, key


def main():
    ap = argparse.ArgumentParser(description="Overhead backend: static app + ADS-B proxy.")
    ap.add_argument("port", nargs="?", type=int, default=8795)
    ap.add_argument("--host", default="127.0.0.1",
                    help="address to listen on; 0.0.0.0 makes it reachable from your network (default: 127.0.0.1)")
    ap.add_argument("--https", action="store_true", help="serve over TLS (self-signed unless --cert/--key are given)")
    ap.add_argument("--cert", help="TLS certificate (PEM)")
    ap.add_argument("--key", help="TLS private key (PEM)")
    args = ap.parse_args()

    httpd = Server((args.host, args.port), Handler)
    scheme = "https" if args.https or args.cert else "http"
    lan = lan_addresses() if args.host in ("0.0.0.0", "") else []
    if scheme == "https":
        cert, key = (args.cert, args.key) if args.cert else \
            self_signed(["localhost", socket.gethostname()], ["127.0.0.1", *lan])
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        # handshake in the request thread, so one slow client can't stall accept()
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True, do_handshake_on_connect=False)

    print(f"Overhead on {scheme}://localhost:{args.port}", flush=True)
    for ip in lan:
        print(f"           {scheme}://{ip}:{args.port}", flush=True)
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print("Reachable from other machines: anyone who can reach it can use the proxy through your IP.", flush=True)
        if scheme == "http":
            print("Phones and tablets need --https for location and compass.", flush=True)
        elif not args.cert:
            print("Self-signed certificate: browsers will warn once; accept it to continue.", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
