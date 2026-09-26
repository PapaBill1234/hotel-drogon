import { createHmac } from 'crypto';

/**
 * RFC 6238 TOTP, enough of it to satisfy the legacy housekeeping login.
 *
 * `housekeeping/index.php:59-66` requires a valid code for any account at or
 * above the `staff_2fa_rank` setting (5 here), so the audit cannot reach a single
 * legacy staff page without one. The fixture account `hkstaff` is provisioned at
 * rank 5 with the secret `JBSWY3DPEHPK3PXP`, and this computes the code the same
 * way `includes/Totp.php` verifies it: HMAC-SHA1, 30-second steps, six digits.
 *
 * Only what the harness needs: base32 decode, HOTP, and the time step. No drift
 * window is implemented because the harness submits a freshly generated code
 * immediately.
 */

/** RFC 4648 base32 decode (no padding required). */
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error(`not base32: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 4226 HOTP for a counter. */
function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // JS bitwise ops are 32-bit, so the high word is written via division.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

/** The current six-digit code for a base32 secret. */
export function totp(secretBase32: string, at: Date = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / 30);
  return hotp(base32Decode(secretBase32), counter);
}
