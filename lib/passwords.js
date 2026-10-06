import bcrypt from "bcryptjs";
import { HttpError } from "./auth.js";

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
// bcrypt only uses the first 72 bytes; reject longer input instead of truncating silently.
const MAX_PASSWORD_BYTES = 72;
const MIN_PASSWORD_LENGTH = 8;

// Compared against when the user does not exist, so response time doesn't reveal
// whether an account exists.
const DUMMY_HASH = bcrypt.hashSync("pqchat-timing-equaliser", BCRYPT_ROUNDS);

export function validatePassword(password, name = "password") {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `${name} must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new HttpError(400, `${name} must be at most ${MAX_PASSWORD_BYTES} bytes`);
  }
  return password;
}

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

export async function verifyPassword(password, hash) {
  if (typeof password !== "string") return false;
  return bcrypt.compare(password, hash || DUMMY_HASH).then((ok) => ok && !!hash);
}
