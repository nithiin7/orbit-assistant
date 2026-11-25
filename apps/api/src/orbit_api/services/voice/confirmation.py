"""Reading a spoken reply to "Shall I do this?".

A transcript is never trusted as approval by itself. Only a short reply made of agreement words
and nothing else counts as yes; a short reply of refusal words counts as no; anything else
(a longer sentence, a question, both yes and no, unrelated speech picked up in the room) is
unclear and changes nothing. Recognition errors therefore fail safe.
"""

import re
import unicodedata
from typing import Final, Literal

Reply = Literal["confirm", "reject", "unclear"]

# A reply longer than this is treated as a new request, not an answer.
MAX_REPLY_WORDS: Final = 6

# English and Hindi (romanized and Devanagari), since code-switching is common.
_YES: Final = frozenset(
    {
        "yes",
        "yeah",
        "yep",
        "yup",
        "sure",
        "ok",
        "okay",
        "confirm",
        "confirmed",
        "approve",
        "approved",
        "proceed",
        "go",
        "ahead",
        "do",
        "it",
        "please",
        "correct",
        "right",
        "send",
        "create",
        "add",
        "save",
        "that's",
        "thats",
        "fine",
        "haan",
        "han",
        "haa",
        "ha",
        "ji",
        "theek",
        "thik",
        "hai",
        "kar",
        "karo",
        "हाँ",
        "हां",
        "जी",
        "ठीक",
        "है",
        "करो",
        "कर",
        "दो",
    }
)
# Words that must appear for a reply to count as yes (filler like "it" or "please" alone
# doesn't).
_YES_CORE: Final = frozenset(
    {
        "yes",
        "yeah",
        "yep",
        "yup",
        "sure",
        "ok",
        "okay",
        "confirm",
        "confirmed",
        "approve",
        "approved",
        "proceed",
        "ahead",
        "correct",
        "haan",
        "han",
        "haa",
        "ha",
        "theek",
        "thik",
        "हाँ",
        "हां",
        "ठीक",
    }
)
_NO: Final = frozenset(
    {
        "no",
        "nope",
        "nah",
        "cancel",
        "stop",
        "don't",
        "dont",
        "reject",
        "not",
        "never",
        "wait",
        "nahin",
        "nahi",
        "mat",
        "ruko",
        "नहीं",
        "मत",
        "रुको",
    }
)
_NO_FILLER: Final = frozenset({"it", "do", "that", "please", "thanks", "thank", "you", "karo"})

# Runs of anything but spaces and punctuation, so Devanagari vowel signs (combining marks, not
# word characters to `\w`) stay inside their word.
_WORD: Final = re.compile(r"[^\s.,!?;:\"“”()\[\]{}…।॥\u2014\u2013-]+")


def words_of(transcript: str) -> list[str]:
    text = unicodedata.normalize("NFC", transcript).casefold().replace("\u2019", "'")
    return _WORD.findall(text)


def classify_reply(transcript: str) -> Reply:
    words = words_of(transcript)
    if not words or len(words) > MAX_REPLY_WORDS or "?" in transcript:
        return "unclear"
    has_no = any(word in _NO for word in words)
    has_yes_core = any(word in _YES_CORE for word in words)
    if has_no:
        # "No", "cancel it", "don't do it": refusal words with only filler around them.
        if all(word in _NO or word in _NO_FILLER for word in words) and not has_yes_core:
            return "reject"
        return "unclear"
    if has_yes_core and all(word in _YES for word in words):
        return "confirm"
    return "unclear"
