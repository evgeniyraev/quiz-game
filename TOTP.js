// totp.js (for your offline JS app)

const TOTP_SECRET = "my-super-secret-key-123"; // MUST match the PHP secret

// Helper: UTF-8 encode string → Uint8Array
function textToBytes(str) {
  return new TextEncoder().encode(str);
}

// Import secret as a CryptoKey for HMAC-SHA1
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

/**
 * Generate TOTP-style code, same as PHP.
 *
 * @param {string} [secret]
 * @param {number} [timeStep]  seconds per time slice
 * @param {number} [digits]    number of digits
 * @param {number} [timestampMs] JS timestamp in ms
 * @returns {Promise<string>}
 */
async function generateTotp(
  secret = TOTP_SECRET,
  timeStep = 30,
  digits = 6,
  timestampMs = Date.now(),
) {
  const timestamp = Math.floor(timestampMs / 1000);
  const counter = Math.floor(timestamp / timeStep);

  // 1. Build 8-byte big-endian counter buffer
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  const high = Math.floor(counter / 2 ** 32);
  const low = counter >>> 0;
  view.setUint32(0, high, false); // big-endian
  view.setUint32(4, low, false);

  // 2. HMAC-SHA1(counterBytes)
  const key = await getHmacKey(secret);
  const hmacArrayBuffer = await crypto.subtle.sign("HMAC", key, buf);
  const hmac = new Uint8Array(hmacArrayBuffer);

  // 3. Dynamic truncation
  const offset = hmac[hmac.length - 1] & 0x0f;

  const binaryCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  // 4. Mod + zero-pad
  const mod = binaryCode % 10 ** digits;
  return mod.toString().padStart(digits, "0");
}

/**
 * Verify user-entered code with small clock drift tolerance.
 *
 * @param {string} inputCode
 * @param {string} [secret]
 * @param {number} [timeStep]
 * @param {number} [digits]
 * @param {number} [timestampMs]
 * @returns {Promise<boolean>}
 */
async function verifyTotp(
  inputCode,
  secret = TOTP_SECRET,
  timeStep = 30,
  digits = 6,
  timestampMs = Date.now(),
) {
  // Accept current, previous, next time slice (clock drift)
  const drifts = [-1, 0, 1];

  for (const delta of drifts) {
    const ts = timestampMs + delta * timeStep * 1000;
    const expected = await generateTotp(secret, timeStep, digits, ts);
    if (expected === inputCode) {
      return true;
    }
  }
  return false;
}

// Example usage in your offline app:
async function onUserEnterCode(codeFromUser) {
  const isValid = await verifyTotp(codeFromUser, TOTP_SECRET, 60); // same step as PHP
  if (isValid) {
    console.log("✅ Code accepted");
  } else {
    console.log("❌ Invalid code");
  }
}

let a = await generateTotp(TOTP_SECRET, 60 * 60 * 24, 4);
console.log(a);
for (var i = 0; i < 10; i++) {
  let b = (Math.random() * 1000000) >> 0;
  let c = b | a; // generation
  console.log(c, (c & a) == a); // reading
}
