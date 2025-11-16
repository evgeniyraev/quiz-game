const TOTP_SECRET = "my-super-secret-key-123"; // Must stay in sync with QuizGame.php
const TIME_STEP_SECONDS = 60 * 60 * 24; // 24-hour window (midnight to midnight)
const TZ_OFFSET_SECONDS = 2 * 60 * 60; // Set to your timezone offset from UTC in seconds (e.g., UTC+3 = 3*3600)
const MASK_DIGITS = 4; // Digits used for the mask

const getDayCounter = (timestampMs = Date.now()) =>
  Math.floor((timestampMs / 1000 + TZ_OFFSET_SECONDS) / TIME_STEP_SECONDS);

function textToBytes(str) {
  return new TextEncoder().encode(str);
}

async function getHmacKey(secret = TOTP_SECRET) {
  const keyData = textToBytes(secret);
  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
}

async function generateTotp(
  secret = TOTP_SECRET,
  timeStepSeconds = TIME_STEP_SECONDS,
  digits = MASK_DIGITS,
  timestampMs = Date.now(),
) {
  // Use a shifted day boundary controlled by TZ_OFFSET_SECONDS.
  const counter = getDayCounter(timestampMs);

  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  const high = Math.floor(counter / 2 ** 32);
  const low = counter >>> 0;
  view.setUint32(0, high, false);
  view.setUint32(4, low, false);

  const key = await getHmacKey(secret);
  const hmacArrayBuffer = await crypto.subtle.sign("HMAC", key, buf);
  const hmac = new Uint8Array(hmacArrayBuffer);

  const offset = hmac[hmac.length - 1] & 0x0f;
  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const mod = binaryCode % 10 ** digits;
  return mod.toString().padStart(digits, "0");
}

async function generateDailyMask(timestampMs = Date.now()) {
  const mask = await generateTotp(
    TOTP_SECRET,
    TIME_STEP_SECONDS,
    MASK_DIGITS,
    timestampMs,
  );
  return Number(mask);
}

async function onUserEnterCode(codeFromUser) {
  const trimmed = String(codeFromUser || "").trim();
  if (!/^\d+$/.test(trimmed)) return false;

  const codeNumber = Number(trimmed);

  const mask = await generateDailyMask(Date.now());
  return (codeNumber & mask) === mask;
}

module.exports = {
  onUserEnterCode,
  getDayCounter,
};
