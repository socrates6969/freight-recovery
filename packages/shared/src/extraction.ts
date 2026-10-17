/**
 * TypeScript mirror of the Python extraction models (`freight_recovery.models`): the input of the
 * step-5 rules engine. Money and hours are DecimalStrings (never floats); datetimes are local times
 * without zone (`YYYY-MM-DDTHH:MM:SS`, the Python naive `datetime.isoformat()` form).
 */
import type { DecimalString } from './decimal.js';

/** `YYYY-MM-DDTHH:MM:SS` local time without zone. */
export type LocalDateTimeString = string;

export interface ChargeLine {
  description: string;
  amount: DecimalString;
}

export interface Invoice {
  invoice_number: string | null;
  load_number: string | null;
  carrier: string | null;
  shipper: string | null;
  invoice_date: string | null;
  lines: ChargeLine[];
  total: DecimalString | null;
  extraction_warnings: string[];
}

export interface RateConfirmation {
  load_number: string | null;
  carrier: string | null;
  linehaul_rate: DecimalString | null;
  fuel_surcharge: DecimalString | null;
  detention_free_hours: DecimalString | null;
  detention_rate_per_hour: DecimalString | null;
  detention_max_hours: DecimalString | null;
  authorized_accessorials: string[];
  extraction_warnings: string[];
}

export interface BillOfLading {
  load_number: string | null;
  facility: string | null;
  appointment_time: LocalDateTimeString | null;
  arrival_time: LocalDateTimeString | null;
  departure_time: LocalDateTimeString | null;
  extraction_warnings: string[];
}

export interface ExtractedBundle {
  invoice: Invoice | null;
  rate_confirmation: RateConfirmation | null;
  bol: BillOfLading | null;
  warnings: string[];
}

export function emptyInvoice(): Invoice {
  return {
    invoice_number: null,
    load_number: null,
    carrier: null,
    shipper: null,
    invoice_date: null,
    lines: [],
    total: null,
    extraction_warnings: [],
  };
}

export function emptyRateConfirmation(): RateConfirmation {
  return {
    load_number: null,
    carrier: null,
    linehaul_rate: null,
    fuel_surcharge: null,
    detention_free_hours: null,
    detention_rate_per_hour: null,
    detention_max_hours: null,
    authorized_accessorials: [],
    extraction_warnings: [],
  };
}

export function emptyBillOfLading(): BillOfLading {
  return { load_number: null, facility: null, appointment_time: null, arrival_time: null, departure_time: null, extraction_warnings: [] };
}
