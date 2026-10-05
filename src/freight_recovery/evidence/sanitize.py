"""Escaping for untrusted document text rendered into Markdown / draft letters.

Everything extracted from an uploaded document (filenames, carrier names, line
descriptions) is attacker-controlled. These helpers keep it on one line, strip
control characters, and neutralise Markdown/HTML metacharacters so it cannot
inject links, HTML, headings, table cells or break out of a code fence.
"""

from __future__ import annotations

import re

_CTRL = re.compile("[\x00-\x1f\x7f-\x9f  ‪-‮⁦-⁩]+")
_MD_META = re.compile(r"([\\`*_\[\]<>|~&#])")
MAX_FIELD = 200


def plain(text: object, limit: int = MAX_FIELD) -> str:
    """One-line plain text: control chars -> space, no backticks/angle brackets, truncated."""
    s = _CTRL.sub(" ", str(text))
    s = re.sub(r"[`<>]", "", s)
    s = re.sub(r" {2,}", " ", s).strip()
    return s if len(s) <= limit else s[: limit - 3] + "..."


def md(text: object, limit: int = MAX_FIELD) -> str:
    """Markdown-safe inline text (one line, metacharacters backslash-escaped)."""
    return _MD_META.sub(r"\\\1", plain(text, limit))
