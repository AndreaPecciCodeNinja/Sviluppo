export const BUSINESS_NUMBER = "+393337802795";
export const BUSINESS_NUMBER_DISPLAY = "+39 333 7802795";

export function normalizePhone(value) {
  if (value == null) return "";
  let raw = String(value).trim();
  if (!raw) return "";
  if (raw.startsWith("00")) raw = raw.slice(2);
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

export function formatPhone(value) {
  const phone = normalizePhone(value);
  if (!phone) return "";
  if (phone === BUSINESS_NUMBER) return BUSINESS_NUMBER_DISPLAY;
  if (phone.startsWith("+39")) {
    const national = phone.slice(3);
    if (national.length === 10) {
      return `+39 ${national.slice(0, 3)} ${national.slice(3)}`;
    }
  }
  return phone;
}

export function recipientAddress(recipient) {
  if (!recipient || typeof recipient !== "object") return null;
  if (recipient.phone_number) {
    return normalizePhone(recipient.phone_number) || null;
  }
  if (typeof recipient.bsuid === "string" && recipient.bsuid.trim()) {
    return recipient.bsuid.trim();
  }
  return null;
}
