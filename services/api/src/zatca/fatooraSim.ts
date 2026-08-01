import { createHmac, randomUUID } from "node:crypto";

// SP-04 (S15), ADR-11: the local FATOORA simulator. D-10/D-12 self-build
// mandate + D-17's own framing ("real ZATCA clearance sits at Tier 3, not
// needed for Tier 2") — this generates a structurally valid ZATCA Phase-1
// simplified-invoice QR (the same 5-tag TLV format a real integration would
// produce) and a placeholder "crypto stamp", but NEVER calls a real ZATCA
// endpoint and NEVER uses a real onboarded CSID/private key (there isn't
// one). The call site here is the adapter boundary ADR-11 asks for — a
// Tier-3 real-ZATCA swap replaces only this module's internals, not any
// caller.
export interface ZatcaInvoiceInput {
  sellerNameAr: string;
  sellerNameEn: string;
  sellerVatNumber: string;
  issuedAt: Date;
  total: string; // inclusive of VAT, money string decimal
  vatAmount: string;
}

export interface ZatcaArtifacts {
  zatcaUuid: string;
  qrTlv: string;
  cryptoStamp: string;
}

function tlvField(tag: number, value: string): Buffer {
  const valueBuf = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from([tag, valueBuf.length]), valueBuf]);
}

// ZATCA simplified-invoice QR: 5 mandatory TLV tags (seller name, VAT
// number, timestamp, invoice total, VAT total), concatenated then
// base64-encoded — the real spec's own wire format, simulator or not.
function buildQrTlv(input: ZatcaInvoiceInput): string {
  const fields = Buffer.concat([
    tlvField(1, input.sellerNameEn),
    tlvField(2, input.sellerVatNumber),
    tlvField(3, input.issuedAt.toISOString()),
    tlvField(4, input.total),
    tlvField(5, input.vatAmount)
  ]);
  return fields.toString("base64");
}

// Not a real ZATCA cryptographic stamp (that requires a government-issued
// CSID this project deliberately never acquires at Tier 2) — an HMAC over
// the same fields the QR encodes, so the simulator's own signature is at
// least internally verifiable and deterministic per invoice, not just a
// random string. The env var is dev-only; ZATCA_SIM_SECRET absent falls
// back to a fixed local string (self-contained by construction, D-12 — no
// external secret to provision for the simulator to function).
function buildCryptoStamp(input: ZatcaInvoiceInput, zatcaUuid: string): string {
  const secret = process.env.ZATCA_SIM_SECRET ?? "zatca-sim-local-dev-only";
  const message = [input.sellerVatNumber, input.issuedAt.toISOString(), input.total, input.vatAmount, zatcaUuid].join("|");
  return createHmac("sha256", secret).update(message).digest("base64");
}

export function generateZatcaArtifacts(input: ZatcaInvoiceInput): ZatcaArtifacts {
  const zatcaUuid = randomUUID();
  return {
    zatcaUuid,
    qrTlv: buildQrTlv(input),
    cryptoStamp: buildCryptoStamp(input, zatcaUuid)
  };
}

export interface ZatcaUblInput extends ZatcaInvoiceInput {
  zatcaUuid: string;
  qrTlv: string;
  invoiceId: string;
  supplierNameAr: string;
  supplierNameEn: string;
  lines: Array<{ nameAr: string; nameEn: string; qty: number; unitPrice: string; vatAmount: string; lineTotal: string }>;
}

// EP-SP-033: regenerated on demand from stored invoice data rather than
// persisted to object storage — same documented SPEC-GAP precedent
// EP-SF-035 (order receipt) already established (no real object storage
// wired for this class of document yet). Deterministic given the same
// inputs, so on-demand regeneration is safe.
export function generateUblXml(input: ZatcaUblInput): string {
  const lineItems = input.lines
    .map(
      (l, i) => `  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity>${l.qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="SAR">${l.unitPrice}</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>${l.nameEn} / ${l.nameAr}</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="SAR">${l.unitPrice}</cbc:PriceAmount></cac:Price>
    <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${l.vatAmount}</cbc:TaxAmount></cac:TaxTotal>
  </cac:InvoiceLine>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${input.invoiceId}</cbc:ID>
  <cbc:UUID>${input.zatcaUuid}</cbc:UUID>
  <cbc:IssueDate>${input.issuedAt.toISOString().slice(0, 10)}</cbc:IssueDate>
  <cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme><cbc:CompanyID>${input.sellerVatNumber}</cbc:CompanyID></cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${input.sellerNameEn} / ${input.sellerNameAr}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyLegalEntity><cbc:RegistrationName>${input.supplierNameEn} / ${input.supplierNameAr}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="SAR">${(Number(input.total) - Number(input.vatAmount)).toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="SAR">${input.total}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="SAR">${input.total}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:TaxTotal><cbc:TaxAmount currencyID="SAR">${input.vatAmount}</cbc:TaxAmount></cac:TaxTotal>
${lineItems}
  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${input.qrTlv}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>
  </cac:AdditionalDocumentReference>
</Invoice>`;
}
