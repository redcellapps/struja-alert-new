// Page bytes -> text. EDS serves UTF-8 (with a BOM) today, but the brief warns it may be
// windows-1251, so detect from the bytes and never trust a declared charset.
// windows-1251 0x80..0xBF as code points (0x98 is undefined); 0xC0..0xFF map to U+0410..U+044F.
// prettier-ignore
const CP1251_HIGH: readonly number[] = [
  0x0402, 0x0403, 0x201a, 0x0453, 0x201e, 0x2026, 0x2020, 0x2021, 0x20ac, 0x2030, 0x0409, 0x2039, 0x040a, 0x040c, 0x040b, 0x040f,
  0x0452, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0xfffd, 0x2122, 0x0459, 0x203a, 0x045a, 0x045c, 0x045b, 0x045f,
  0x00a0, 0x040e, 0x045e, 0x0408, 0x00a4, 0x0490, 0x00a6, 0x00a7, 0x0401, 0x00a9, 0x0404, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x0407,
  0x00b0, 0x00b1, 0x0406, 0x0456, 0x0491, 0x00b5, 0x00b6, 0x00b7, 0x0451, 0x2116, 0x0454, 0x00bb, 0x0458, 0x0405, 0x0455, 0x0457,
];

export type Encoding = 'utf-8' | 'windows-1251';

export function decodeWindows1251(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b < 0xc0) out += String.fromCharCode(CP1251_HIGH[b - 0x80] ?? 0xfffd);
    else out += String.fromCharCode(0x0410 + (b - 0xc0));
  }
  return out;
}

export function decodePage(bytes: Uint8Array): { text: string; encoding: Encoding } {
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const body = bytes.subarray(start);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8' };
  } catch {
    return { text: decodeWindows1251(body), encoding: 'windows-1251' };
  }
}
