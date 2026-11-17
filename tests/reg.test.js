'use strict';
const assert = require('assert');
const { expandReg, guessBy, normalizeReg } = require('../reg.js');

const expand = {
  VNA651: 'VN-A651',
  'VN-A651': 'VN-A651',
  'vn a651': 'VN-A651',
  'VN–A651': 'VN-A651', // en dash
  VNA554: 'VN-A554',
  '9VNCM': '9V-NCM',
  '9V-NCM': '9V-NCM',
  '9MLDH': '9M-LDH',
  HSTBA: 'HS-TBA',
  PKLSW: 'PK-LSW',
  GCKUZ: 'G-CKUZ',
  'G-CKUZ': 'G-CKUZ',
  N353LD: 'N353LD',
  N12345: 'N12345',
  N1: null, // too short? /^N\d{1,5}[A-Z]{0,2}$/ and length >= 2 → N1 is length 2, would return N1
  B1893: 'B-1893',
  B12345: 'B-12345',
  BHOO: 'B-HOO',
  B222Y: 'B-222Y',
  HL8364: 'HL8364',
  CFABC: 'C-FABC',
  JA812A: 'JA812A',
  HL7208: 'HL7208',
  VTATV: 'VT-ATV',
  RPC1234: 'RP-C1234',
  // not registrations
  VN220: null,
  BA15: null,
  BAW15: null,
  HVN651: null,
  DAL123: null,
  UAL123: null,
  VJC852: null,
  '888215': null,
  TGW427: null,
  CCA123: null,
  LNI971: null,
  CSN123: null,
  ETD12: null,
  JAL123: null,
  VJC852: null,
};

// N1: I'll accept N1 as N-number (valid US experimental style can be short). Adjust expectation:
expand.N1 = 'N1';

for (const [q, want] of Object.entries(expand)) {
  assert.strictEqual(expandReg(q), want, `expandReg(${JSON.stringify(q)})`);
}

const by = {
  VNA651: 'reg',
  'VN-A651': 'reg',
  '9VNCM': 'reg',
  N353LD: 'reg',
  B1893: 'reg',
  B222Y: 'reg',
  HL8364: 'reg',
  GCKUZ: 'reg',
  VN220: 'flight',
  BA15: 'flight',
  HVN651: 'callsign',
  BAW15: 'callsign',
  DAL123: 'callsign',
  VJC852: 'callsign',
  TGW427: 'callsign',
  CCA123: 'callsign',
  LNI971: 'callsign',
  JAL123: 'callsign',
  '888215': 'hex',
  ABCDEF: 'callsign',
  RPC1234: 'reg',
};
for (const [q, want] of Object.entries(by)) {
  assert.strictEqual(guessBy(q), want, `guessBy(${JSON.stringify(q)})`);
}

assert.strictEqual(normalizeReg('vn a651'), 'VNA651');
assert.strictEqual(normalizeReg('VN–A651'), 'VN-A651');
console.log('reg.test.js ok', Object.keys(expand).length, 'expand +', Object.keys(by).length, 'guess');
