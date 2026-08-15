/**
 * Human-readable invoice reference, e.g. `CM-6QK8-4F2M`.
 *
 * Students, vendors and agents read this aloud to each other, so the alphabet
 * omits characters that are easy to mishear or mistype (0/O, 1/I). Uniqueness is
 * guaranteed by the unique index on `Order.reference`, not by this function; the
 * random body only makes a collision unlikely enough to be rare.
 *
 * `random` is injectable so the format can be tested deterministically.
 */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateOrderReference(random: () => number = Math.random): string {
  let body = "";
  for (let index = 0; index < 8; index += 1) {
    body += ALPHABET[Math.floor(random() * ALPHABET.length)];
    if (index === 3) body += "-";
  }
  return `CM-${body}`;
}
