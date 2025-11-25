import CryptoJS from "crypto-js";
import elliptic from "elliptic";
import { createBech32 } from "./bech32"; // переносим из index.html

const ec = new elliptic.ec("secp256k1");

// HMAC-SHA512 for derivation
function deriveChildKey(masterPriv: string, chainCode: string, index: number) {
  const data = masterPriv + index.toString(16).padStart(8, "0");

  const I = CryptoJS.HmacSHA512(
    CryptoJS.enc.Hex.parse(data),
    CryptoJS.enc.Hex.parse(chainCode)
  ).toString();

  return {
    privateKey: I.substring(0, 64),
    nextChainCode: I.substring(64),
  };
}

export function generateHDAddress(
  masterPriv: string,
  chainCode: string,
  index: number
) {
  const child = deriveChildKey(masterPriv, chainCode, index);

  const keyPair = ec.keyFromPrivate(child.privateKey);
  const publicKey = keyPair.getPublic(true, "hex");

  // HASH160 (SHA256 → RIPEMD)
  const sha = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(publicKey)).toString();
  const hash160 = CryptoJS.RIPEMD160(CryptoJS.enc.Hex.parse(sha)).toString();

  // witness program = 20 bytes of HASH160
  const programBytes = Uint8Array.from(
    hash160.match(/../g)!.map((x) => parseInt(x, 16))
  );

  // Bech32 encode
  const address = createBech32("alpha", 0, programBytes);

  return {
    address,
    privateKey: child.privateKey,
    publicKey,
    index,
  };
}
