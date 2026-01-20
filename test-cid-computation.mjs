/**
 * Test script to understand CID mismatch issue
 *
 * This tests how CIDs are computed for JSON data to identify
 * why fetched content has a different CID than expected.
 */

import * as jsonCodec from 'multiformats/codecs/json';
import { sha256 } from 'multiformats/hashes/sha2';
import { CID } from 'multiformats/cid';
import * as dagJson from '@ipld/dag-json';

// Test data - same content with different key orderings
const data1 = { tokens: [], meta: { version: 1 }, tombstones: [] };
const data2 = { meta: { version: 1 }, tombstones: [], tokens: [] };

console.log('=== Testing multiformats/codecs/json (used in computeCidFromContent) ===\n');

// Encode with multiformats/codecs/json (simple JSON.stringify)
const encoded1 = jsonCodec.encode(data1);
const encoded2 = jsonCodec.encode(data2);

console.log('Data 1:', data1);
console.log('Encoded 1:', Buffer.from(encoded1).toString('utf-8'));
console.log('Encoded 1 bytes:', encoded1);
console.log();

console.log('Data 2:', data2);
console.log('Encoded 2:', Buffer.from(encoded2).toString('utf-8'));
console.log('Encoded 2 bytes:', encoded2);
console.log();

console.log('Encodings match?', Buffer.from(encoded1).toString() === Buffer.from(encoded2).toString());
console.log();

// Compute CIDs
const hash1 = await sha256.digest(encoded1);
const cid1 = CID.createV1(jsonCodec.code, hash1);

const hash2 = await sha256.digest(encoded2);
const cid2 = CID.createV1(jsonCodec.code, hash2);

console.log('CID 1:', cid1.toString());
console.log('CID 2:', cid2.toString());
console.log('CIDs match?', cid1.toString() === cid2.toString());
console.log();

console.log('=== Testing @ipld/dag-json (deterministic encoding) ===\n');

// Encode with @ipld/dag-json (CBOR-based JSON with sorted keys)
const dagEncoded1 = dagJson.encode(data1);
const dagEncoded2 = dagJson.encode(data2);

console.log('DAG-JSON Encoded 1:', Buffer.from(dagEncoded1).toString('utf-8'));
console.log('DAG-JSON Encoded 2:', Buffer.from(dagEncoded2).toString('utf-8'));
console.log();

console.log('DAG-JSON encodings match?', Buffer.from(dagEncoded1).toString() === Buffer.from(dagEncoded2).toString());
console.log();

// Compute CIDs using dag-json codec
const dagHash1 = await sha256.digest(dagEncoded1);
const dagCid1 = CID.createV1(dagJson.code, dagHash1);

const dagHash2 = await sha256.digest(dagEncoded2);
const dagCid2 = CID.createV1(dagJson.code, dagHash2);

console.log('DAG-JSON CID 1:', dagCid1.toString());
console.log('DAG-JSON CID 2:', dagCid2.toString());
console.log('DAG-JSON CIDs match?', dagCid1.toString() === dagCid2.toString());
console.log();

console.log('=== Summary ===\n');
console.log('The issue is:');
console.log('- multiformats/codecs/json uses plain JSON.stringify (NON-deterministic key ordering)');
console.log('- @ipld/dag-json uses CBOR with sorted keys (DETERMINISTIC)');
console.log('- IpfsPublisher uses JSON.stringify to upload content');
console.log('- computeCidFromContent uses multiformats/codecs/json (JSON.stringify)');
console.log('- If key ordering changes, CIDs will differ even for same content!');
console.log();
console.log('Codec codes:');
console.log('- json codec (0x0200):', jsonCodec.code.toString(16));
console.log('- dag-json codec (0x0129):', dagJson.code.toString(16));
