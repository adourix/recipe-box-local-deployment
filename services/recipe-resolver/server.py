#!/usr/bin/env python3
import html
import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from yt_dlp import YoutubeDL

try:
    from curl_cffi import requests as curl_requests
except ImportError:
    curl_requests = None

ALLOWED_HOSTS = {
    "instagram.com", "www.instagram.com", "m.instagram.com",
    "facebook.com", "www.facebook.com", "m.facebook.com", "fb.watch", "fb.com",
    "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
    "youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com",
}

TIKTOK_HOSTS = {"tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"}


def proxy_enabled():
    return os.environ.get("RESOLVER_PROXY_ENABLED", "false").strip().lower() in {
        "1", "true", "yes", "on"
    }


def configured_proxy():
    if not proxy_enabled():
        return None
    proxy = os.environ.get("RESOLVER_PROXY", "").strip()
    if not proxy:
        raise RuntimeError("resolver proxy is enabled but not configured")
    return proxy


def is_tiktok_url(url):
    hostname = (urlparse(url).hostname or "").lower().rstrip(".")
    return hostname in TIKTOK_HOSTS


def first_value(obj, keys):
    if isinstance(obj, dict):
        for key in keys:
            value = obj.get(key)
            if isinstance(value, str) and value:
                return value
        for value in obj.values():
            found = first_value(value, keys)
            if found:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = first_value(value, keys)
            if found:
                return found
    return None


def find_video_metadata(obj):
    """Find a TikTok video metadata object regardless of current nesting."""
    if isinstance(obj, dict):
        if any(isinstance(obj.get(k), str) and obj.get(k) for k in ("playAddr", "downloadAddr", "playApi")):
            return obj
        for value in obj.values():
            found = find_video_metadata(value)
            if found:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = find_video_metadata(value)
            if found:
                return found
    return None


def find_item_struct(obj):
    if isinstance(obj, dict):
        item = obj.get("itemStruct")
        if isinstance(item, dict):
            return item
        for value in obj.values():
            found = find_item_struct(value)
            if found:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = find_item_struct(value)
            if found:
                return found
    return None


def extract_tiktok_from_page(url, proxy):
    if curl_requests is None:
        raise RuntimeError("curl_cffi is required for TikTok resolution")

    response = curl_requests.get(
        url,
        proxy=proxy,
        impersonate="chrome",
        timeout=30,
        allow_redirects=True,
    )
    response.raise_for_status()
    page = response.text

    match = re.search(
        r'<script[^>]+id=["\']__UNIVERSAL_DATA_FOR_REHYDRATION__["\'][^>]*>(.*?)</script>',
        page,
        re.DOTALL | re.IGNORECASE,
    )
    if not match:
        raise RuntimeError("TikTok universal data was not found")

    raw = html.unescape(match.group(1)).strip()
    data = json.loads(raw)

    item = find_item_struct(data) or {}
    video_data = item.get("video") if isinstance(item.get("video"), dict) else None
    if not video_data:
        video_data = find_video_metadata(data)

    if not isinstance(video_data, dict):
        raise RuntimeError("TikTok video metadata was not found")

    video_url = (
        video_data.get("playAddr")
        or video_data.get("downloadAddr")
        or video_data.get("playApi")
    )
    if isinstance(video_url, list):
        video_url = video_url[0] if video_url else None
    if not isinstance(video_url, str) or not video_url:
        raise RuntimeError("TikTok video URL was not found")

    title = item.get("desc") or first_value(data, {"desc"})
    author = item.get("author") if isinstance(item.get("author"), dict) else {}
    uploader = (
        author.get("uniqueId")
        or author.get("nickname")
        or first_value(data, {"uniqueId", "nickname"})
    )
    duration = video_data.get("duration")
    thumbnail = (
        video_data.get("cover")
        or video_data.get("originCover")
        or video_data.get("dynamicCover")
    )

    return {
        "video_url": video_url,
        "video_filesize": None,
        "audio_url": None,
        "title": title,
        "duration": duration,
        "uploader": uploader,
        "thumbnail": thumbnail,
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

            proxy = configured_proxy()

            if is_tiktok_url(url):
                try:
                    result = extract_tiktok_from_page(url, proxy)
                    return self._json(200, result)
                except Exception as tiktok_exc:
                    self.log_error("TikTok page resolver failed: %s", tiktok_exc)

            configured_cookie_file = os.environ.get("RESOLVER_COOKIES_FILE", "").strip()
            cookie_text = os.environ.get("RESOLVER_COOKIES", "").strip()
            opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True}

            if proxy:
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
