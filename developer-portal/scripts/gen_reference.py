"""Render openapi.json into a static Markdown API reference (docs/api/reference.md).

Pure stdlib. The output is generated from the real spec at build time and is not committed,
so the reference cannot drift from the code.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "openapi.json"
OUT = ROOT / "docs" / "api" / "reference.md"
METHODS = ("get", "post", "put", "patch", "delete")


def ref_name(ref: str) -> str:
    return ref.rsplit("/", 1)[-1]


def type_of(schema: dict) -> str:
    if "$ref" in schema:
        name = ref_name(schema["$ref"])
        return f"[`{name}`](#{name.lower()})"
    if "anyOf" in schema:
        return " or ".join(type_of(s) for s in schema["anyOf"])
    if "allOf" in schema:
        return " + ".join(type_of(s) for s in schema["allOf"])
    t = schema.get("type", "any")
    if t == "array":
        return f"array of {type_of(schema.get('items', {}))}"
    if "enum" in schema:
        return " or ".join(f"`{v}`" for v in schema["enum"])
    fmt = schema.get("format")
    return f"{t} ({fmt})" if fmt else str(t)


def cell(text: str) -> str:
    return " ".join(str(text).split()).replace("|", "\\|")


def constraints(schema: dict) -> str:
    keys = ("minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "default")
    return ", ".join(f"{k}={schema[k]}" for k in keys if k in schema)


def main() -> None:
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    info = spec["info"]
    lines = [
        "# API reference (generated)",
        "",
        f"Generated from the application's own OpenAPI document: **{info['title']}**, "
        f"API version `{info['version']}`. Interactive view: [Redoc](redoc.html). "
        "Raw spec: [openapi.json](openapi.json).",
        "",
        '!!! warning "Pre-product"',
        "    This reference is the *real current* surface of a pre-product service. It is not a "
        "stability promise; see the [changelog](../changelog.md).",
        "",
        "Every route except `GET /health` requires an API key "
        "([Authentication](../authentication.md)).",
        "",
        "## Endpoints",
        "",
    ]
    for path, item in spec["paths"].items():
        for method in METHODS:
            op = item.get(method)
            if not op:
                continue
            lines += [f"### `{method.upper()} {path}`", "", f"**{op.get('summary', '')}**", ""]
            if op.get("description"):
                lines += [op["description"].strip(), ""]
            auth = "API key required" if op.get("security") else "none (anonymous)"
            lines += [f"Authentication: {auth}.", ""]
            params = op.get("parameters", [])
            if params:
                lines += ["| Parameter | In | Type | Required | Constraints |", "|---|---|---|---|---|"]
                for p in params:
                    ps = p.get("schema", {})
                    lines.append(
                        f"| `{p['name']}` | {p['in']} | {type_of(ps)} | "
                        f"{'yes' if p.get('required') else 'no'} | {cell(constraints(ps))} |"
                    )
                lines.append("")
            for ctype, media in op.get("requestBody", {}).get("content", {}).items():
                lines += [f"Request body (`{ctype}`): {type_of(media.get('schema', {}))}", ""]
            lines += ["| Status | Meaning | Body |", "|---|---|---|"]
            for code, resp in op.get("responses", {}).items():
                body = ""
                for media in resp.get("content", {}).values():
                    body = type_of(media.get("schema", {}))
                lines.append(f"| `{code}` | {cell(resp.get('description', ''))} | {body} |")
            lines.append("")
    lines += ["## Schemas", ""]
    for name, schema in sorted(spec.get("components", {}).get("schemas", {}).items()):
        lines += [f"### {name}", ""]
        if schema.get("description"):
            lines += [schema["description"].strip(), ""]
        if "enum" in schema:
            lines += ["One of: " + ", ".join(f"`{v}`" for v in schema["enum"]), ""]
            continue
        props = schema.get("properties", {})
        if not props:
            continue
        req = set(schema.get("required", []))
        lines += ["| Field | Type | Required | Constraints |", "|---|---|---|---|"]
        for field, fs in props.items():
            lines.append(
                f"| `{field}` | {type_of(fs)} | {'yes' if field in req else 'no'} | "
                f"{cell(constraints(fs))} |"
            )
        lines.append("")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
