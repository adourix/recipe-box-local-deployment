#!/usr/bin/env python3
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from yt_dlp import YoutubeDL

ALLOWED_HOSTS = {
    "instagram.com", "www.instagram.com", "m.instagram.com",
    "facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch", "fb.com",
    "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
    "youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com",
}


def proxy_enabled():
    return os.environ.get("RESOLVER_PROXY_ENABLED", "false").strip().lower() in {
        "1", "true", "yes", "on"
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "RecipeResolver/1.0"

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/":
            return self._json(404, {"error": "not found"})
        secret = os.environ.get("RESOLVER_SECRET", "")
        if not secret or self.headers.get("x-internal-secret") != secret:
            return self._json(401, {"error": "unauthorized"})
        cookie_file = None
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 65536:
                return self._json(400, {"error": "invalid request size"})
            data = json.loads(self.rfile.read(size))
            url = str(data.get("url", "")).strip()
            parsed = urlparse(url)
            if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
                return self._json(400, {"error": "unsupported URL"})

            configured_cookie_file = os.environ.get("RESOLVER_COOKIES_FILE", "").strip()
            cookie_text = os.environ.get("RESOLVER_COOKIES", "").strip()
            opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True}

            if proxy_enabled():
                proxy = os.environ.get("RESOLVER_PROXY", "").strip()
                if not proxy:
                    return self._json(500, {"error": "resolver proxy is enabled but not configured"})
                opts["proxy"] = proxy

            if configured_cookie_file:
                opts["cookiefile"] = configured_cookie_file
            elif cookie_text:
                cookie_file = "/tmp/resolver-cookies.txt"
                with open(cookie_file, "w", encoding="utf-8") as f:
                    f.write(cookie_text)
                opts["cookiefile"] = cookie_file

            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)

            formats = info.get("formats", [])
            videos = [
                f for f in formats
                if f.get("url") and f.get("vcodec") != "none" and f.get("height")
            ]
            videos.sort(
                key=lambda f: (
                    f.get("height") or 0,
                    f.get("filesize") or f.get("filesize_approx") or 0,
                )
            )
            audios = [
                f for f in formats
                if f.get("url") and f.get("acodec") != "none" and f.get("vcodec") == "none"
            ]
            audio = audios[-1] if audios else None
            video = videos[-1] if videos else None
            result = {
                "video_url": video.get("url") if video else None,
                "video_filesize": (
                    video.get("filesize") or video.get("filesize_approx")
                ) if video else None,
                "audio_url": audio.get("url") if audio else None,
                "title": info.get("title"),
                "duration": info.get("duration"),
                "uploader": info.get("uploader"),
                "thumbnail": info.get("thumbnail"),
            }
            if not result["video_url"] and not result["audio_url"]:
                return self._json(422, {"error": "no downloadable media"})
            return self._json(200, result)
        except Exception as exc:
            self.log_error("resolve failure: %s", exc)
            return self._json(422, {"error": "resolve failed"})
        finally:
            if cookie_file and os.path.exists(cookie_file):
                os.remove(cookie_file)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


def main():
    host = os.environ.get("RESOLVER_HOST", "127.0.0.1")
    port = int(os.environ.get("RESOLVER_PORT", os.environ.get("PORT", "8081")))
    server = ThreadingHTTPServer((host, port), Handler)
    print("recipe-resolver listening on %s:%s" % (host, port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
