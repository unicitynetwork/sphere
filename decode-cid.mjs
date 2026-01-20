/**
 * Decode the mismatched CIDs to understand what codec they use
 */

import { CID } from 'multiformats/cid';

const expectedCid = 'bagaaiera5tb3ebbkjhkyfjlu2ipdkpnrpyw3vg4upu4hw4d2miosv6oluetq';
const computedCid = 'bagaaiera6s5yxkajmw22t6ikooheqxmsywqedghqyypv7cgsrizz2w43vcxq';

console.log('Expected CID:', expectedCid);
const expected = CID.parse(expectedCid);
console.log('  Version:', expected.version);
console.log('  Codec:', expected.code, '(0x' + expected.code.toString(16) + ')');
console.log('  Multihash:', expected.multihash.code, '(0x' + expected.multihash.code.toString(16) + ')');
console.log();

console.log('Computed CID:', computedCid);
const computed = CID.parse(computedCid);
console.log('  Version:', computed.version);
console.log('  Codec:', computed.code, '(0x' + computed.code.toString(16) + ')');
console.log('  Multihash:', computed.multihash.code, '(0x' + computed.multihash.code.toString(16) + ')');
console.log();

console.log('Codec reference:');
console.log('  0x0200 = json (multiformats/codecs/json)');
console.log('  0x0129 = dag-json (@ipld/dag-json)');
console.log('  0x0055 = raw (raw bytes)');
console.log();

if (expected.code === 0x0200 && computed.code === 0x0200) {
  console.log('Both use json codec - the issue is key ordering!');
} else if (expected.code !== computed.code) {
  console.log('CODEC MISMATCH! Expected:', expected.code, 'Computed:', computed.code);
}
