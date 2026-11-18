'use strict';
// Rasterize in a bounded worker. SVGs are read as data, never executed or opened.
const fs = require('node:fs');
const path = require('node:path');
const {Worker, isMainThread, parentPort, workerData} = require('node:worker_threads');
const MAX_BYTES = 512 * 1024;
let renderer;
async function dominantColor(source) {
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) throw new Error('SVG exceeds the analysis limit.');
  // No external images, entities, scripts or fonts are loaded by this analyzer.
  if (/<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|image)\b/i.test(source)) throw new Error('Unsupported SVG resource.');
  if (!/<svg\b/i.test(source)) throw new Error('Not an SVG.');
  // Unspecified fills and context-dependent colors have no intrinsic color.
  // Wrapper inheritance preserves explicit SVG colors, including explicit black.
  source = source.replace(/<svg\b([^>]*)>/i, (tag, attrs) => {
    if (!/\bxmlns\s*=/.test(attrs)) tag = tag.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    if (!/\sfill\s*=/i.test(attrs)) tag = tag.replace('>', ' fill="none">');
    if (!/\scolor\s*=/i.test(attrs)) tag = tag.replace('>', ' color="transparent">');
    return tag;
  });
  renderer ||= (async () => {
    const api = require('../vendor/resvg-wasm');
    await api.initWasm(fs.readFileSync(path.join(__dirname, '../vendor/resvg-wasm/index_bg.wasm')));
    return api;
  })();
  const {Resvg} = await renderer;
  let svg, image;
  try {
    svg = new Resvg(source, {font: {loadSystemFonts: false}});
    const extent = Math.max(svg.width, svg.height);
    if (!Number.isFinite(extent) || extent <= 0) return null;
    const normalized = svg.toString();
    svg.free(); svg = undefined;
    svg = new Resvg(normalized, {font: {loadSystemFonts: false}, fitTo: {mode: 'zoom', value: 256 / extent}});
    // resvg serializes computed paints in document order. Definitions themselves
    // do not contribute area: only the rendered, alpha-weighted pixels do.
    const computed = [];
    for (const match of normalized.matchAll(/\b(?:fill|stroke|stop-color)="(#[\da-f]{6})"/gi)) {
      const color = match[1].toLowerCase();
      if (!computed.includes(color)) computed.push(color);
    }
    const order = [], parsed = new Map();
    for (const match of source.replace(/<!--[\s\S]*?-->/g, '').matchAll(/\b(?:fill|stroke|stop-color|color)\s*(?:=\s*["']([^"']+)["']|:\s*([^;"'{}<>]+))/gi)) {
      const raw = (match[1] || match[2]).trim().replace(/\s*!important\s*$/i, '');
      if (!/^[#a-z\d(),.%+\s/-]+$/i.test(raw) || /^(?:none|transparent|currentColor|inherit|initial|unset)$|(?:url|var)\(/i.test(raw)) continue;
      if (!parsed.has(raw)) {
        let sample;
        try {
          sample = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" fill="none" color="transparent"><path fill="${raw}" d="M0 0h1v1H0z"/></svg>`);
          parsed.set(raw, /\bfill="(#[\da-f]{6})"/i.exec(sample.toString())?.[1].toLowerCase());
        } finally { sample?.free(); }
      }
      const color = parsed.get(raw);
      if (computed.includes(color) && !order.includes(color)) order.push(color);
    }
    for (const color of computed) if (!order.includes(color)) order.push(color);
    if (!order.length) return null;
    image = svg.render();
    const pixels = image.pixels;
    const histogram = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i + 3];
      if (!alpha) continue;
      const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      histogram.set(key, (histogram.get(key) || 0) + alpha);
    }
    if (!histogram.size) return null;
    // Match antialiased and composited pixels to their closest source paint.
    const paints = order.map(color => ({color, rgb: parseInt(color.slice(1), 16), area: 0}));
    for (const [rgb, area] of histogram) {
      let nearest = paints[0], distance = Infinity;
      for (const paint of paints) {
        const delta = ((rgb >> 16) - (paint.rgb >> 16)) ** 2
          + (((rgb >> 8) & 255) - ((paint.rgb >> 8) & 255)) ** 2
          + ((rgb & 255) - (paint.rgb & 255)) ** 2;
        if (delta < distance) { nearest = paint; distance = delta; }
      }
      nearest.area += area;
    }
    return paints.reduce((best, paint) => paint.area > best.area ? paint : best).color;
  } finally { image?.free(); svg?.free(); }
}
function analyzeSVG(source, {timeout = 5000} = {}) {
  if (Buffer.byteLength(source, 'utf8') > MAX_BYTES) return Promise.reject(new Error('SVG exceeds the analysis limit.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {workerData: {source}});
    const timer = setTimeout(() => finish(new Error('SVG analysis timed out.')), timeout);
    let done = false;
    function finish(error, value) {
      if (done) return;
      done = true; clearTimeout(timer); void worker.terminate();
      if (error) reject(error); else resolve(value);
    }
    worker.once('message', result => result.error ? finish(new Error(result.error)) : finish(null, result.color));
    worker.once('error', finish);
    worker.once('exit', code => { if (!done) finish(new Error(`SVG worker exited (${code}).`)); });
  });
}
if (!isMainThread && workerData?.source !== undefined) {
  dominantColor(workerData.source).then(color => parentPort.postMessage({color}), error => parentPort.postMessage({error: error.message}));
}
module.exports = {dominantColor, analyzeSVG, MAX_BYTES};
