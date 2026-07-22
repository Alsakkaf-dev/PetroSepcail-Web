// PC-10 (FR-PC10-001/TC-PC10-001): "logs are JSON, PII-masked (no raw
// phone/email)". Pino's path-based `redact` only catches known object
// shapes; it cannot catch PII embedded in an arbitrary message string (e.g.
// "login failed for jdoe@example.com"). These regex maskers are the
// complementary, string-content-based half — see logger.ts's `hooks.logMethod`
// for where they run on every log call.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Saudi mobile (FR-PC01 phone format: +966 5XXXXXXXX), with or without the
// country code / leading zero.
const SAUDI_MOBILE_PATTERN = /(?:\+?966|0)5\d{8}\b/g;

export function maskEmail(text: string): string {
  return text.replace(EMAIL_PATTERN, (match) => {
    const at = match.indexOf("@");
    const local = match.slice(0, at);
    const domain = match.slice(at);
    return `${local.slice(0, 1)}***${domain}`;
  });
}

export function maskPhone(text: string): string {
  return text.replace(SAUDI_MOBILE_PATTERN, (match) => `${match.slice(0, 4)}***${match.slice(-2)}`);
}

export function maskPii(text: string): string {
  return maskPhone(maskEmail(text));
}
