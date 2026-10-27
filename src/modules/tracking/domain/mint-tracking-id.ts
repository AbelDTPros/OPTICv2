import { randomBytes } from 'node:crypto';

/** Crockford Base32 without I, L, O, U — easier to read aloud from stickers. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BODY_LENGTH = 10;

/** `{M|W}-` + 10 Crockford chars, e.g. `M-7K9Q2X4P8R`. */
export const TRACKING_ID_PATTERN = /^[MW]-[0-9A-HJKMNP-TV-Z]{10}$/;

export function trackingIdPrefix(entityType: string): 'M' | 'W' {
  return entityType.trim().toUpperCase() === 'MAIL' ? 'M' : 'W';
}

export function mintTrackingIdValue(entityType: string): string {
  return `${trackingIdPrefix(entityType)}-${randomCrockford(BODY_LENGTH)}`;
}

function randomCrockford(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += CROCKFORD[bytes[index]! & 31]!;
  }
  return out;
}
