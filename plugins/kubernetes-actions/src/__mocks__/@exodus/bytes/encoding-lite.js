// CJS shim so jest (CommonJS mode) can load @exodus/bytes/encoding-lite.js
// which ships as ESM-only.  Only the two symbols used by html-encoding-sniffer
// (jsdom dep) need real implementations.
'use strict';

// Mapping of common IANA charset labels → normalised names
const LABEL_MAP = {
  'utf-8': 'UTF-8', 'utf8': 'UTF-8',
  'utf-16': 'UTF-16', 'utf-16le': 'UTF-16LE', 'utf-16be': 'UTF-16BE',
  'iso-8859-1': 'windows-1252', 'latin1': 'windows-1252',
  'windows-1252': 'windows-1252',
  'ascii': 'windows-1252', 'us-ascii': 'windows-1252',
};

function labelToName(label) {
  if (!label) return null;
  return LABEL_MAP[String(label).toLowerCase().trim()] ?? null;
}

function getBOMEncoding(uint8Array) {
  const b = uint8Array;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return 'UTF-8';
  if (b[0] === 0xfe && b[1] === 0xff) return 'UTF-16BE';
  if (b[0] === 0xff && b[1] === 0xfe) return 'UTF-16LE';
  return null;
}

module.exports = { labelToName, getBOMEncoding };
