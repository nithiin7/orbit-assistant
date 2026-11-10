"""What a URL alone says about a bookmark: its kind and a readable default title. Nothing here
contacts the page."""

from urllib.parse import unquote, urlsplit

from orbit_api.services.bookmarks.models import MAX_TITLE_LENGTH, BookmarkKind, BookmarkStatus

_VIDEO_HOSTS = ("youtube.com", "youtu.be", "vimeo.com", "dailymotion.com", "twitch.tv")
_REPO_HOSTS = ("github.com", "gitlab.com", "bitbucket.org", "codeberg.org")
_ARTICLE_HOSTS = ("medium.com", "substack.com", "dev.to", "wikipedia.org")


def _host(url: str) -> str:
    host = (urlsplit(url).hostname or "").lower()
    return host.removeprefix("www.").removeprefix("m.")


def _on(host: str, domains: tuple[str, ...]) -> bool:
    return any(host == domain or host.endswith(f".{domain}") for domain in domains)


def guess_kind(url: str) -> BookmarkKind:
    """The kind a URL most likely is, from its host and path."""
    host = _host(url)
    path = urlsplit(url).path.lower()
    if _on(host, ("instagram.com",)) and path.startswith(("/reel/", "/reels/")):
        return "reel"
    if _on(host, ("tiktok.com",)) or (_on(host, ("youtube.com",)) and path.startswith("/shorts/")):
        return "reel"
    if _on(host, ("facebook.com",)) and path.startswith("/reel/"):
        return "reel"
    if _on(host, _VIDEO_HOSTS):
        return "video"
    if _on(host, _REPO_HOSTS) and len([part for part in path.split("/") if part]) >= 2:
        return "repo"
    if _on(host, _ARTICLE_HOSTS) or "/blog/" in path:
        return "article"
    return "link"


def default_status(kind: BookmarkKind) -> BookmarkStatus:
    """Things to consume start on the read-later queue; everything else is kept for reference."""
    return "later" if kind in ("article", "video", "reel") else "reference"


def default_title(url: str) -> str:
    """The host and last path segment, such as "github.com · orbit"."""
    host = _host(url) or url
    segments = [part for part in urlsplit(url).path.split("/") if part]
    title = host
    if segments:
        decoded = "".join(c for c in unquote(segments[-1]) if c.isprintable())
        last = decoded.replace("-", " ").replace("_", " ").strip()
        if last:
            title = f"{host} · {last}"
    title = " ".join(title.split())
    return title[:MAX_TITLE_LENGTH] or "Untitled"
