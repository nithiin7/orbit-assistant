from pathlib import Path

from orbit_api.openapi import render_openapi

CONTRACT = Path(__file__).parents[3] / "packages" / "contracts" / "openapi.json"


def test_shared_contract_matches_api() -> None:
    """The committed contract must match the API. Fix with `pnpm contracts:generate`."""
    assert CONTRACT.read_text(encoding="utf-8") == render_openapi()
