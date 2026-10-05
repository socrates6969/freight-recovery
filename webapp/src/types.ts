/** Hand-written mirror of the API's pydantic models (src/freight_recovery/models.py, api/main.py). */
export type Perspective = "shipper" | "carrier";

export interface Finding {
  rule_id: string;
  title: string;
  direction: string;
  amount: string; // Decimal serialised as a string
  explanation: string;
  calculation: string[];
  confidence: number;
  needs_human_review: boolean;
}

export interface RecoveryResult {
  perspective: Perspective;
  findings: Finding[];
  recoverable_total: string;
  pending_review_total: string;
  ignored_findings: Finding[];
}

export interface PacketDocument {
  filename: string;
  doc_type: string;
  sha256: string;
}

export interface EvidencePacket {
  load_number: string | null;
  perspective: Perspective;
  generated_at: string;
  documents: PacketDocument[];
  result: RecoveryResult;
  demand_letter: string;
  markdown: string;
  disclaimer: string;
}

export interface AnalysisResponse {
  packet: EvidencePacket;
  analysis_id: string | null;
}

export interface AnalysisSummary {
  id: string;
  status: string;
  perspective: string;
  load_number: string | null;
  recoverable_total: string | null;
  pending_review_total: string | null;
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
  document_count: number;
}

export interface AnalysisList {
  items: AnalysisSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface AnalysisRecord extends AnalysisSummary {
  documents: { filename: string; sha256: string; size_bytes: number }[];
  packet: EvidencePacket | null;
}
