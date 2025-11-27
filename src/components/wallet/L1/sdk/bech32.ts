// sdk/l1/bech32.ts

// CHARSET from BIP-173
export const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

// -----------------------------
// Convert bit arrays (8→5 / 5→8)
// -----------------------------
export function convertBits(
  data: number[],
  fromBits: number,
  toBits: number,
  pad: boolean
) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (value < 0 || value >> fromBits !== 0) return null;
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      ret.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || (acc << (toBits - bits)) & maxv) {
    return null;
  }

  return ret;
}

// -----------------------------
// HRP Expand
// -----------------------------
function hrpExpand(hrp: string) {
  const ret = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

// -----------------------------
// Polymod (checksum core)
// -----------------------------
function bech32Polymod(values: number[]) {
  const GENERATOR = [
    0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
  ];

  let chk = 1;
  for (let p = 0; p < values.length; p++) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ values[p];
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATOR[i];
    }
  }
  return chk;
}

// -----------------------------
// Create checksum
// -----------------------------
function bech32Checksum(hrp: string, data: number[]) {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = bech32Polymod(values) ^ 1;

  const ret = [];
  for (let p = 0; p < 6; p++) {
    ret.push((mod >> (5 * (5 - p))) & 31);
  }
  return ret;
}

// -----------------------------
// ENCODE (create address)
// -----------------------------
export function createBech32(
  hrp: string,
  version: number,
  program: Uint8Array
) {
  if (version < 0 || version > 16) {
    throw new Error("Invalid witness version");
  }

  const data = [version].concat(convertBits(Array.from(program), 8, 5, true)!);

  const checksum = bech32Checksum(hrp, data);
  const combined = data.concat(checksum);

  let out = hrp + "1";
  for (let i = 0; i < combined.length; i++) {
    out += CHARSET[combined[i]];
  }

  return out;
}

// -----------------------------
// DECODE (parse address)
// -----------------------------
export function decodeBech32(addr: string) {
  addr = addr.toLowerCase();

  const pos = addr.lastIndexOf("1");
  if (pos < 1) return null;

  const hrp = addr.substring(0, pos);
  const dataStr = addr.substring(pos + 1);

  const data = [];
  for (let i = 0; i < dataStr.length; i++) {
    const val = CHARSET.indexOf(dataStr[i]);
    if (val === -1) return null;
    data.push(val);
  }

  // Validate checksum
  const checksum = bech32Checksum(hrp, data.slice(0, -6));
  for (let i = 0; i < 6; i++) {
    if (checksum[i] !== data[data.length - 6 + i]) {
      console.error("Invalid bech32 checksum");
      return null;
    }
  }

  const version = data[0];
  const program = convertBits(data.slice(1, -6), 5, 8, false);
  if (!program) return null;

  return {
    hrp,
    witnessVersion: version,
    data: Uint8Array.from(program),
  };
}
