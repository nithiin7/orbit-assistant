import uuid
from typing import Any

import pytest

from orbit_api.services.notes.content import (
    MAX_CONTENT_LENGTH,
    InvalidDocumentError,
    build_document,
    document_from_text,
    linked_note_id,
    note_href,
)
from orbit_api.services.notes.service import excerpt, normalize_tag_name, search_terms


def text(value: str, *marks: dict[str, Any]) -> dict[str, Any]:
    node: dict[str, Any] = {"type": "text", "text": value}
    if marks:
        node["marks"] = list(marks)
    return node


def doc(*blocks: dict[str, Any]) -> dict[str, Any]:
    return {"type": "doc", "content": list(blocks)}


def paragraph(*children: dict[str, Any]) -> dict[str, Any]:
    return {"type": "paragraph", "content": list(children)}


def link(href: str) -> dict[str, Any]:
    return {"type": "link", "attrs": {"href": href}}


def test_plain_text_puts_each_block_on_its_own_line() -> None:
    document = build_document(
        doc(
            {"type": "heading", "attrs": {"level": 1}, "content": [text("Plan")]},
            paragraph(text("Buy "), text("milk", {"type": "bold"})),
            {
                "type": "taskList",
                "content": [
                    {
                        "type": "taskItem",
                        "attrs": {"checked": True},
                        "content": [paragraph(text("Call Ada"))],
                    }
                ],
            },
            {"type": "codeBlock", "content": [text("print(1)")]},
            {"type": "horizontalRule"},
        )
    )
    assert document.plain_text == "Plan\nBuy milk\nCall Ada\nprint(1)"


def test_tables_and_quotes_are_accepted() -> None:
    cell = {"type": "tableCell", "content": [paragraph(text("A1"))]}
    header = {"type": "tableHeader", "content": [paragraph(text("Col"))]}
    document = build_document(
        doc(
            {
                "type": "table",
                "content": [
                    {"type": "tableRow", "content": [header]},
                    {"type": "tableRow", "content": [cell]},
                ],
            },
            {"type": "blockquote", "content": [paragraph(text("Quoted"))]},
        )
    )
    assert document.plain_text == "Col\nA1\nQuoted"


def test_note_links_are_collected_by_id_once() -> None:
    target = uuid.uuid4()
    document = build_document(
        doc(
            paragraph(text("See", link(note_href(target)))),
            paragraph(text("again", link(note_href(target)))),
            paragraph(text("web", link("https://example.com"))),
        )
    )
    assert document.linked_note_ids == {target}


def test_note_href_round_trips() -> None:
    note_id = uuid.uuid4()
    assert linked_note_id(note_href(note_id)) == note_id
    assert linked_note_id("/notes?note=nope") is None
    assert linked_note_id(f"https://evil.example/notes?note={note_id}") is None


@pytest.mark.parametrize(
    "href", ["javascript:alert(1)", "data:text/html,hi", "JAVASCRIPT:alert(1)", "/settings"]
)
def test_unsafe_links_are_rejected(href: str) -> None:
    with pytest.raises(InvalidDocumentError, match="link"):
        build_document(doc(paragraph(text("x", link(href)))))


@pytest.mark.parametrize(
    ("content", "message"),
    [
        ({"type": "paragraph"}, "type 'doc'"),
        ([], "type 'doc'"),
        (doc({"type": "iframe"}), "unsupported element"),
        (doc(paragraph(text("x", {"type": "highlight"}))), "unsupported formatting"),
        (doc(paragraph({"type": "text", "text": ""})), "without text"),
        (doc({"type": "paragraph", "content": "text"}), "invalid content"),
        (doc({"type": "paragraph", "attrs": "x"}), "invalid attributes"),
        (doc({"type": "paragraph", "marks": [{"type": "bold"}]}), "marks"),
        (doc(paragraph(text("x", {"type": "link"}))), "without an address"),
    ],
)
def test_invalid_documents_are_rejected(content: object, message: str) -> None:
    with pytest.raises(InvalidDocumentError, match=message):
        build_document(content)


def test_deep_nesting_is_rejected() -> None:
    node: dict[str, Any] = paragraph(text("deep"))
    for _ in range(50):
        node = {"type": "blockquote", "content": [node]}
    with pytest.raises(InvalidDocumentError, match="deeply"):
        build_document(doc(node))


def test_oversized_documents_are_rejected() -> None:
    with pytest.raises(InvalidDocumentError, match="too long"):
        build_document(doc(paragraph(text("x" * MAX_CONTENT_LENGTH))))


def test_text_becomes_paragraphs() -> None:
    document = document_from_text("First\n\nThird")
    assert document.plain_text == "First\nThird"
    assert document.json.count('"paragraph"') == 3


def test_tag_names_compare_without_case_or_extra_spaces() -> None:
    assert normalize_tag_name("  Deep   Work ") == normalize_tag_name("deep work") == "deep work"


def test_search_terms_split_on_whitespace_and_cap_at_eight() -> None:
    assert search_terms("  alpha  beta ") == ["alpha", "beta"]
    assert len(search_terms(" ".join(str(n) for n in range(20)))) == 8
    assert search_terms(None) == []


def test_excerpt_shows_the_start_or_the_first_match() -> None:
    assert excerpt("Short\ntext") == "Short text"
    long = ("lorem ipsum " * 40) + "needle in the haystack " + ("dolor " * 40)
    shown = excerpt(long, ["NEEDLE"])
    assert "needle" in shown
    assert shown.startswith("…")
    assert shown.endswith("…")
