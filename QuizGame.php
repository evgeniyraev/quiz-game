<?php
// -------------------------
// CONFIGURATION
// -------------------------

const TOTP_SECRET = "my-super-secret-key-123";   // MUST match JS
const TIME_STEP   = 24 * 60 * 60;                       // 24 hours
const TZ_OFFSET_SECONDS = 2 * 60 * 60;                     // Set to timezone offset from UTC in seconds (e.g., UTC+3 = 3*3600)
const MASK_DIGITS = 4;                           // 4-digit mask
const OUTPUT_DIGITS = 6;                         // digits to display (e.g., 6)

// -------------------------
// GENERATE TOTP MASK (4 DIGITS, DAILY)
// -------------------------
function generate_totp_mask(): int
{
    $timestamp = time(); // current seconds since 1970 (UTC)
    // Shift day boundary by TZ_OFFSET_SECONDS so one code covers 00:00–23:59 in that zone.
    $counter = intdiv($timestamp + TZ_OFFSET_SECONDS, TIME_STEP);

    // Convert counter to 8-byte big-endian
    $binaryCounter = pack("N*", 0) . pack("N*", $counter);

    // HMAC-SHA1(secret, counter)
    $hash = hash_hmac("sha1", $binaryCounter, TOTP_SECRET, true);

    // Dynamic truncation (standard TOTP)
    $offset = ord(substr($hash, -1)) & 0x0F;
    $part = substr($hash, $offset, 4);
    $value = unpack("N", $part)[1] & 0x7FFFFFFF;

    // Convert to MASK_DIGITS (e.g. 4 digits)
    $mask = $value % (10 ** MASK_DIGITS);
    return $mask;
}

// -------------------------
// GENERATE DISPLAY CODE
// -------------------------
function generate_display_code(): string
{
    $dailyMask = generate_totp_mask();      // The TOTP mask for today
    $randomValue = random_int(0, 999999);   // Random noise

    // Combine like your JS logic: random OR mask
    $combined = $randomValue | $dailyMask;

    // Format as fixed-width output (e.g. 6 digits)
    return str_pad((string)$combined, OUTPUT_DIGITS, "0", STR_PAD_LEFT);
}

// -------------------------
// OUTPUT HTML PAGE
// -------------------------
$code = generate_display_code();
?>

<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Daily Code</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background: #f7f7f7;
            text-align: center;
            padding-top: 80px;
        }
        .code-box {
            font-size: 64px;
            font-weight: bold;
            background: white;
            padding: 30px 60px;
            display: inline-block;
            border-radius: 12px;
            box-shadow: 0 0 10px #aaa;
        }
    </style>
</head>
<body>

<div class="code-box">
    <?= htmlspecialchars($code) ?>
</div>

</body>
</html>
