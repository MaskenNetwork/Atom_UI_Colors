'use strict';

// Contrast is evaluated on the final 8-bit sRGB color, not on rounded ratios.
const linear = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const encoded = value => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
function parseHex(value) {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return null;
  let hex = value.slice(1);
  if (hex.length < 5) hex = [...hex].map(char => char + char).join('');
  const channels = hex.match(/../g).map(channel => parseInt(channel, 16));
  return {rgb: channels.slice(0, 3), alpha: channels.length === 4 ? Math.round(channels[3] / 255 * 1000) / 1000 : 1};
}
const hexOf = rgb => '#' + rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('');
function luminance(rgb) {
  const [r, g, b] = rgb.map(value => linear(value / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(foreground, background) {
  const a = luminance(parseHex(foreground).rgb), b = luminance(parseHex(background).rgb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function toLab(rgb) {
  const [r, g, b] = rgb.map(value => linear(value / 255));
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [0.2104542553*l + 0.793617785*m - 0.0040720468*s,
    1.9779984951*l - 2.428592205*m + 0.4505937099*s,
    0.0259040371*l + 0.7827717662*m - 0.808675766*s];
}
function fromLab([L, a, b]) {
  const l = (L + 0.3963377774*a + 0.2158037573*b) ** 3;
  const m = (L - 0.1055613458*a - 0.0638541728*b) ** 3;
  const s = (L - 0.0894841775*a - 1.291485548*b) ** 3;
  return [4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
    -0.0041960863*l - 0.7034186147*m + 1.707614701*s];
}
function gamutColor(L, a, b) {
  // Reduce chroma at a fixed hue when a lightness change leaves sRGB's gamut.
  let low = 0, high = 1;
  const inGamut = rgb => rgb.every(value => value >= -1e-7 && value <= 1 + 1e-7);
  let rgb = fromLab([L, a, b]);
  if (!inGamut(rgb)) {
    for (let i = 0; i < 20; i++) {
      const scale = (low + high) / 2;
      if (inGamut(fromLab([L, a * scale, b * scale]))) low = scale; else high = scale;
    }
    rgb = fromLab([L, a * low, b * low]);
  }
  return hexOf(rgb.map(value => Math.round(Math.max(0, Math.min(1, encoded(value))) * 255)));
}
function ensureContrast(foreground, background, minimum = 3) {
  const fg = parseHex(foreground), bg = parseHex(background);
  if (!fg || !bg || fg.alpha !== 1 || bg.alpha !== 1 || !Number.isFinite(minimum) || minimum < 1 || minimum > 21) return null;
  if (contrastRatio(foreground, background) >= minimum) return foreground;
  const [L, a, b] = toLab(fg.rgb), candidates = [];
  for (const end of [0, 1]) {
    let failed = L, passed = end;
    if (contrastRatio(gamutColor(end, a, b), background) < minimum) continue;
    for (let i = 0; i < 24; i++) {
      const middle = (failed + passed) / 2;
      if (contrastRatio(gamutColor(middle, a, b), background) >= minimum) passed = middle; else failed = middle;
    }
    const color = gamutColor(passed, a, b);
    if (contrastRatio(color, background) >= minimum) candidates.push({color, distance: Math.abs(passed - L)});
  }
  return candidates.sort((a, b) => a.distance - b.distance)[0]?.color || null;
}

module.exports = {parseHex, hexOf, contrastRatio, ensureContrast};
