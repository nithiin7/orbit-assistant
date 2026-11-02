"""Embedding vectors: storage encoding and similarity.

Vectors are normalized to unit length when stored, so cosine similarity is a dot product. They
are stored as little-endian float32 bytes, which reads back the same on any machine and in
both SQLite (BLOB) and PostgreSQL (BYTEA). Scoring is brute force in Python, which is fine for a
personal index (tens of thousands of chunks); see `docs/architecture.md#vector-storage`.
"""

import heapq
import math
import sys
from array import array
from collections.abc import Iterable, Sequence
from operator import mul


def normalize(vector: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0 or not math.isfinite(norm):
        raise ValueError("A vector must be finite and not all zeros.")
    return [value / norm for value in vector]


def pack(vector: Sequence[float]) -> bytes:
    values = array("f", vector)
    if sys.byteorder == "big":
        values.byteswap()
    return values.tobytes()


def unpack(data: bytes) -> list[float]:
    values = array("f")
    values.frombytes(data)
    if sys.byteorder == "big":
        values.byteswap()
    return values.tolist()


def dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(map(mul, a, b))


def top_k[T](
    query: Sequence[float], items: Iterable[tuple[T, Sequence[float]]], k: int
) -> list[tuple[float, T]]:
    """The `k` items most similar to `query` (both normalized), best first. Items whose
    dimensions differ from the query's are skipped."""
    size = len(query)
    scored = (
        (dot(query, vector), index, item)
        for index, (item, vector) in enumerate(items)
        if len(vector) == size
    )
    return [(score, item) for score, _, item in heapq.nlargest(k, scored)]
