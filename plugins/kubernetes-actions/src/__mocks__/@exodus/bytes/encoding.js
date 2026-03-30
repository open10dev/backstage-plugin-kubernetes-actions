'use strict';
// CJS shim for @exodus/bytes/encoding.js
// jsdom uses: legacyHookDecode(html, encoding)
const { getBOMEncoding, labelToName } = require('./encoding-lite.js');

function legacyHookDecode(input, fallbackEncoding = 'utf-8') {
  if (typeof input === 'string') return input;
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const bomEnc = getBOMEncoding(u8);
  const data = bomEnc
    ? u8.subarray(bomEnc === 'UTF-8' ? 3 : 2)
    : u8;
  return new TextDecoder(bomEnc ?? fallbackEncoding ?? 'utf-8').decode(data);
}

module.exports = { legacyHookDecode };
