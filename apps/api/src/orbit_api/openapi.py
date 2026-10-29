"""Export the OpenAPI schema that defines the API contract shared with the web app.

Usage: `python -m orbit_api.openapi <path> [--check]`
"""

import argparse
import json
import sys
from pathlib import Path

from orbit_api.config import Settings
from orbit_api.main import create_app


def render_openapi() -> str:
    """Render the schema as stable, formatted JSON, independent of the local environment."""
    settings = Settings(env="test", _env_file=None)  # pyright: ignore[reportCallIssue]
    schema = create_app(settings).openapi()
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="Where to write the schema.")
    parser.add_argument(
        "--check", action="store_true", help="Fail if the file is missing or out of date."
    )
    args = parser.parse_args(argv)
    path: Path = args.path
    content = render_openapi()

    if args.check:
        if not path.exists() or path.read_text(encoding="utf-8") != content:
            print(f"{path} is out of date. Run `pnpm contracts:generate`.", file=sys.stderr)
            return 1
        return 0

    path.write_text(content, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
