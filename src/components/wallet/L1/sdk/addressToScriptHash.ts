import { decodeBech32 } from "./bech32";
import CryptoJS from "crypto-js";

/** Convert bytes to hex */
function bytesToHex(buf: Uint8Array) {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert "alpha1xxxx" Bech32 → Electrum script hash
 * Required for:
 *  - blockchain.scripthash.get_history
 *  - blockchain.scripthash.listunspent
 */
export function addressToScriptHash(address: string): string {
  const decoded = decodeBech32(address);
  if (!decoded) throw new Error("Invalid bech32 address: " + address);

  // witness program always starts with OP_0 + PUSH20 (for P2WPKH)
  const scriptHex = "0014" + bytesToHex(decoded.data);

  // SHA256
  const sha = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(scriptHex)).toString();

  // Electrum requires reversed byte order
  return sha.match(/../g)!.reverse().join("");
}
