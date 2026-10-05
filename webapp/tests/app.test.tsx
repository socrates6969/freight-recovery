import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { Packet } from "../src/components/Packet";
import { api } from "../src/api";
import { keystore, looksLikeKey } from "../src/keystore";
import type { EvidencePacket } from "../src/types";

const packet: EvidencePacket = {
  load_number: "L<img src=x onerror=alert(1)>",
  perspective: "shipper",
  generated_at: "2026-01-01T00:00:00",
  documents: [{ filename: "<script>x</script>.txt", doc_type: "invoice", sha256: "a".repeat(64) }],
  result: {
    perspective: "shipper",
    findings: [
      {
        rule_id: "r",
        title: "<b>Bold</b>",
        direction: "d",
        amount: "10.00",
        explanation: "e",
        calculation: ["1+1"],
        confidence: 0.9,
        needs_human_review: true,
      },
    ],
    recoverable_total: "0.00",
    pending_review_total: "10.00",
    ignored_findings: [],
  },
  demand_letter: "DRAFT - FOR HUMAN REVIEW. NOT SENT.",
  markdown: "# md",
  disclaimer: "disc",
};

afterEach(() => {
  keystore.clear();
  localStorage.clear();
  sessionStorage.clear();
});

describe("pilot UI", () => {
  it("shows the DRAFT / synthetic-data framing", () => {
    render(<App />);
    expect(screen.getByText(/PRE-PRODUCT\. DRAFT output\. SYNTHETIC/)).toBeInTheDocument();
  });

  it("renders API content as text, never HTML; shows DRAFT-DO-NOT-SEND and sha256", () => {
    const { container } = render(<Packet packet={packet} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/DRAFT - DO NOT SEND/)).toBeInTheDocument();
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
    expect(screen.getByText(/needs human review/)).toBeInTheDocument();
  });

  it("keeps the API key in memory only and sends it as X-API-Key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], total: 0, limit: 1, offset: 0 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    keystore.set("frk_deadbeef_" + "x".repeat(43));
    await api.list(1, 0);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/analyses?limit=1&offset=0");
    expect((init.headers as Headers).get("X-API-Key")).toMatch(/^frk_/);
    expect(init.credentials).toBe("omit");
    expect(localStorage.length + sessionStorage.length).toBe(0);
    vi.unstubAllGlobals();
  });

  it("key shape check", () => {
    expect(looksLikeKey("frk_deadbeef_" + "A".repeat(43))).toBe(true);
    expect(looksLikeKey("nope")).toBe(false);
  });

  it("gates Analyze/History until a key is loaded; key input is a password field", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Analyze" })).toBeDisabled();
    const input = screen.getByLabelText("API key", { selector: "input" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "frk_x" } });
    expect(input.type).toBe("password");
  });
});
