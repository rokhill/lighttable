import { ethers } from "ethers";

// ---------------------------------------------------------------------------
// Lightweight signature auth. The client signs a human-readable message with
// their wallet; the server recovers the signer and checks it matches the
// claimed address. This stops anyone from renaming someone else's profile or
// (for the owner address) hiding recipes they don't control.
//
// Messages include a timestamp; we reject anything older than a few minutes to
// limit replay.
// ---------------------------------------------------------------------------

const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export const OWNER_ADDRESS = "0xDB902DC48ef55d5D69F6cB72583518577C6C021c".toLowerCase();

export function profileMessage(address: string, name: string, ts: number): string {
  return `LightTable: set display name\nAddress: ${address}\nName: ${name}\nTime: ${ts}`;
}

export function moderationMessage(action: string, id: number, ts: number): string {
  return `LightTable: ${action} recipe\nId: ${id}\nTime: ${ts}`;
}

export function rankOverrideMessage(address: string, ts: number): string {
  return `LightTable: set rank/badge override\nFor: ${address}\nTime: ${ts}`;
}

/** Returns the recovered signer address (lowercase) if the signature is valid
 *  and fresh, else null. */
export function recoverFresh(message: string, signature: string, ts: number): string | null {
  if (!ts || Date.now() - ts > MAX_AGE_MS || ts - Date.now() > MAX_AGE_MS) return null;
  try {
    const signer = ethers.verifyMessage(message, signature);
    return signer.toLowerCase();
  } catch {
    return null;
  }
}
