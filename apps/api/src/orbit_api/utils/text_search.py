"""Substring search shared by repositories."""

LIKE_ESCAPE = "\\"


def escape_like(text: str) -> str:
    """`text` with LIKE's wildcards (and the escape character) matched literally. Use it with
    `escape=LIKE_ESCAPE`."""
    for character in (LIKE_ESCAPE, "%", "_"):
        text = text.replace(character, LIKE_ESCAPE + character)
    return text


def contains_pattern(text: str) -> str:
    """A LIKE pattern matching `text` anywhere, with LIKE's wildcards matched literally. Use it
    with `escape=LIKE_ESCAPE`."""
    return f"%{escape_like(text)}%"


def prefix_pattern(text: str) -> str:
    """A LIKE pattern matching values that start with `text`. Use it with `escape=LIKE_ESCAPE`."""
    return f"{escape_like(text)}%"
