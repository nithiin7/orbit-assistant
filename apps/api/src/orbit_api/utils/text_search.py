"""Substring search shared by repositories."""

LIKE_ESCAPE = "\\"


def contains_pattern(text: str) -> str:
    """A LIKE pattern matching `text` anywhere, with LIKE's wildcards matched literally. Use it
    with `escape=LIKE_ESCAPE`."""
    for character in (LIKE_ESCAPE, "%", "_"):
        text = text.replace(character, LIKE_ESCAPE + character)
    return f"%{text}%"
