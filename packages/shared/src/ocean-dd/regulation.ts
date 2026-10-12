/**
 * C10: regulation text quoted in D&D findings and stored as a packet source. Verbatim from the eCFR, title 46
 * up to date as of 2026-10-07 (DD_REGULATION_VERSION). 46 CFR 541.4 is not included: it was set aside by the
 * D.C. Circuit on 2025-09-23 (World Shipping Council v. FMC) and removed effective 2025-12-29 (FR Doc.
 * 2025-23920). No rule checks who was billed.
 */

export const DD_REGULATION_TEXT = Object.freeze({
  '46 CFR 541.5':
    'Failure to include any of the required minimum information in this part in a demurrage or detention invoice eliminates any obligation of the billed party to pay the applicable charge.',
  '46 CFR 541.6(a)':
    'A demurrage or detention invoice must be accurate and contain sufficient information to enable the billed party to identify the container(s) to which the charges apply and at a minimum must include: (1) The Bill of Lading number(s); (2) The container number(s); (3) For imports, the port(s) of discharge; and (4) The basis for why the billed party is the proper party of interest and thus liable for the charge.',
  '46 CFR 541.6(b)':
    'A demurrage or detention invoice must be accurate and contain sufficient information to enable the billed party to identify the relevant time for which the charges apply and the applicable due date for invoiced charges and at a minimum must include: (1) The invoice date; (2) The invoice due date; (3) The allowed free time in days; (4) The start date of free time; (5) The end date of free time; (6) For imports, the container availability date; (7) For exports, the earliest return date; and (8) The specific date(s) for which demurrage and/or detention were charged.',
  '46 CFR 541.6(c)':
    'A demurrage or detention invoice must be accurate and contain sufficient information to enable the billed party to identify the amount due and readily ascertain how that amount was calculated and must include at a minimum: (1) The total amount due; (2) The applicable detention or demurrage rule (e.g., the tariff name and rule number, terminal schedule, applicable service contract number and section, or applicable negotiated arrangement) on which the daily rate is based; and (3) The specific rate or rates per the applicable tariff rule or service contract.',
  '46 CFR 541.6(d)':
    "A demurrage or detention invoice must be accurate and contain sufficient information to enable the billed party to readily identify a contact to whom they may direct questions or concerns related to the invoice and understand the process to request fee mitigation, refund, or waiver, and at a minimum must include: (1) The email, telephone number, or other appropriate contact information for questions or request for fee mitigation, refund, or waiver; (2) Digital means, such as a URL address, QR code, or digital watermark, that directs the billed party to a publicly accessible website that provides a detailed description of information or documentation that the billed party must provide to successfully request fee mitigation, refund, or waiver; and (3) Defined timeframes that comply with the billing practices in this part, during which the billed party must request a fee mitigation, refund, or waiver and within which the billing party will resolve such requests.",
  '46 CFR 541.6(e)':
    "A demurrage or detention invoice must be accurate and contain statements from the billing party that: (1) The charges are consistent with any of the Federal Maritime Commission's rules related to demurrage and detention, including, but not limited to, this part and 46 CFR 545.5; and (2) The billing party's performance did not cause or contribute to the underlying invoiced charges.",
  '46 CFR 541.7(a)':
    'A billing party must issue a demurrage or detention invoice within thirty (30) calendar days from the date on which the charge was last incurred. If the billing party does not issue a demurrage or detention invoice within thirty (30) calendar days from the date on which the charge was last incurred, then the billed party is not required to pay the charge.',
  '46 CFR 541.7(b)':
    'If the billing party is a non-vessel-operating common carrier, then it must issue a demurrage or detention invoice within thirty (30) calendar days from the issuance date of the demurrage or detention invoice it received. If such a billing party does not issue a demurrage or detention invoice within thirty (30) calendar days from the issuance date of the demurrage or detention invoice it received, then the billed party is not required to pay the charge.',
  '46 CFR 541.8(a)':
    'The billing party must allow the billed party at least thirty (30) calendar days from the invoice issuance date to request mitigation, refund, or waiver of fees from the billing party.',
  '46 CFR 541.8(b)':
    'If a billing party receives a fee mitigation, refund, or waiver request from a billed party, the billing party must attempt to resolve the request within thirty (30) calendar days of receiving such a request or at a later date as agreed upon by both parties.',
  '46 CFR 545.5(c)(2)(i)':
    'Cargo availability. The Commission may consider in the reasonableness analysis the extent to which demurrage practices and regulations relate demurrage or free time to cargo availability for retrieval.',
  '46 CFR 545.5(c)(2)(ii)':
    'Empty container return. Absent extenuating circumstances, practices and regulations that provide for imposition of detention when it does not serve its incentivizing purposes, such as when empty containers cannot be returned, are likely to be found unreasonable.',
} as const);

export type DdRegulationKey = keyof typeof DD_REGULATION_TEXT;
