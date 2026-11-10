"""Link previews: reading a page's title, description, preview image, and icon from its HTML, and
recognizing the images that come back. Pure functions; fetching lives in
`providers/web/link_preview.py`.

Everything here treats the page as untrusted: text is collapsed to one line and cut to length,
and only `http`/`https` image addresses are kept.
"""

from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Literal
from urllib.parse import urljoin, urlsplit

PreviewContentType = Literal["image/jpeg", "image/png", "image/gif", "image/webp", "image/x-icon"]

MAX_PREVIEW_TITLE = 200
MAX_PREVIEW_DESCRIPTION = 500
# Only this much of a page is read for its metadata, which lives in `<head>`.
MAX_HTML_BYTES = 512 * 1024
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_ICON_BYTES = 256 * 1024


@dataclass(frozen=True, slots=True)
class PageMeta:
    title: str | None = None
    description: str | None = None
    # Absolute `http`/`https` addresses.
    image_url: str | None = None
    icon_url: str | None = None
    # The page's `og:type`, such as `video.other` or `article`.
    og_type: str | None = None


def _clean(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    cleaned = " ".join("".join(c if c.isprintable() else " " for c in text).split())
    return cleaned[:limit].rstrip() or None


def _web_url(base: str, href: str | None) -> str | None:
    if not href or not href.strip():
        return None
    url = urljoin(base, href.strip())
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname or len(url) > 2048:
        return None
    return url


class _HeadParser(HTMLParser):
    """Collects `<title>`, `<meta>`, and icon `<link>` tags, stopping at `<body>`."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.icons: list[tuple[str, str]] = []
        self.title_parts: list[str] = []
        self._in_title = False
        self.done = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.done:
            return
        values = {name.lower(): value or "" for name, value in attrs}
        if tag == "body":
            self.done = True
        elif tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (values.get("property") or values.get("name") or "").strip().lower()
            if key and "content" in values:
                self.meta.setdefault(key, values["content"])
        elif tag == "link":
            rel = values.get("rel", "").lower().split()
            if "icon" in rel or "apple-touch-icon" in rel:
                self.icons.append((" ".join(rel), values.get("href", "")))

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "head":
            self.done = True

    def handle_data(self, data: str) -> None:
        if self._in_title and not self.done:
            self.title_parts.append(data)


def parse_page(html: str, page_url: str) -> PageMeta:
    """The preview details in a page's `<head>`, preferring Open Graph and Twitter tags."""
    parser = _HeadParser()
    try:
        parser.feed(html)
        parser.close()
    except (AssertionError, ValueError):
        # A malformed page still yields whatever was read before the error.
        pass
    meta = parser.meta

    def first(*keys: str) -> str | None:
        return next((meta[key] for key in keys if meta.get(key, "").strip()), None)

    # A plain icon beats an Apple touch icon, which is usually larger than needed.
    icons = sorted(parser.icons, key=lambda icon: "apple-touch-icon" in icon[0])
    icon_url = next((url for _, href in icons if (url := _web_url(page_url, href))), None)
    return PageMeta(
        title=_clean(
            first("og:title", "twitter:title") or "".join(parser.title_parts), MAX_PREVIEW_TITLE
        ),
        description=_clean(
            first("og:description", "twitter:description", "description"),
            MAX_PREVIEW_DESCRIPTION,
        ),
        image_url=_web_url(
            page_url, first("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src")
        ),
        icon_url=icon_url or _web_url(page_url, "/favicon.ico"),
        og_type=_clean(first("og:type"), 40),
    )


def sniff_image(data: bytes, *, allow_icon: bool) -> PreviewContentType | None:
    """The image type from the file's first bytes, or `None` for anything else (SVG included,
    since it can carry script)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    if allow_icon and data.startswith(b"\x00\x00\x01\x00"):
        return "image/x-icon"
    return None
