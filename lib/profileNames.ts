import { ethers } from "ethers";

// Client-side helpers for signing profile + moderation actions, mirroring the
// server's message format in lib/auth.ts. The signature proves wallet control
// without any password or session.

export function profileMessage(address: string, name: string, ts: number): string {
  return `LightTable: set display name\nAddress: ${address}\nName: ${name}\nTime: ${ts}`;
}

export function moderationMessage(action: string, id: number, ts: number): string {
  return `LightTable: ${action} recipe\nId: ${id}\nTime: ${ts}`;
}

export function rankOverrideMessage(address: string, ts: number): string {
  return `LightTable: set rank/badge override\nFor: ${address}\nTime: ${ts}`;
}

export async function signMessage(signer: ethers.JsonRpcSigner, message: string): Promise<string> {
  return signer.signMessage(message);
}

/** Display name for an address, falling back to a short address. */
export function nameFor(address: string, profiles: Record<string, string>): string {
  const n = profiles[address?.toLowerCase()];
  return n && n.trim() ? n : `${address.slice(0, 6)}…${address.slice(-4)}`;
}
