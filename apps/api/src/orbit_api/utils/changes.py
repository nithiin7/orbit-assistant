"""The `UNSET` sentinel for partial updates."""

from enum import Enum, auto
from typing import Final, Literal


class _Unset(Enum):
    UNSET = auto()


UNSET: Final = _Unset.UNSET

# A field in a partial update: a new value, or `UNSET` to leave it as it is. `None` stays
# available as a value, for fields that can be cleared.
type Change[T] = T | Literal[_Unset.UNSET]
