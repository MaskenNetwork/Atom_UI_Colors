'use strict';
const {parseHex, hexOf, ensureContrast} = require('./contrast.cjs');
const {variable} = require('./activity-contrast.cjs');

function renderStatusBarContrast(scope, colors, theme) {
  const unique = [...new Set(colors.map(color => color.toLowerCase()))].sort();
  if (!unique.length) return '';
  const bar = `${scope} .part.statusbar`;
  const label = '> .items-container > .statusbar-item > .statusbar-item-label';
  // currentColor on the glyph's pseudo-element inherits the native foreground,
  // including per-item colors and state changes, without recoloring label text.
  let css = '/* Status bar contrast: verify the painted inline background, including debugging, empty and inactive windows. */\n';
  css += `${bar} ${label} { ${unique.map(color => `${variable(color)}: currentColor;`).join(' ')} }\n`;
  css += `${bar} :is(.monaco-menu,.monaco-hover) { ${unique.map(color => `${variable(color)}: initial;`).join(' ')} }\n`;
  // Special/extension-painted entries retain their native semantic foreground.
  // Their backgrounds need not match the bar and cannot be inferred from it.
  const item = '.statusbar-item:not(.has-background-color):not([style*="background" i]):not(.warning-kind):not(.error-kind):not(.remote-kind):not(.offline-kind):not(.prominent-kind)';
  const plain = `> .items-container > ${item} > .statusbar-item-label:not([style*="background" i])`;
  const values = new Map();
  function declarations(background) {
    if (!values.has(background)) values.set(background, unique.map(color => `${variable(color)}: ${ensureContrast(color, background) || 'currentColor'};`).join(' '));
    return values.get(background);
  }
  function overlays(token, defaults) {
    return [...new Map([theme[token], ...defaults].map(parseHex).filter(Boolean).map(color => {
      // Match VS Code's serialized theme alpha, as with activity bar overlays.
      const alpha = +color.alpha.toFixed(2);
      return [alpha === 1 ? hexOf(color.rgb) : `rgba(${color.rgb.join(', ')}, ${alpha})`, {...color, alpha}];
    })).entries()];
  }
  const backgrounds = [...new Set(['#007acc', '#68217a', '#cc6633', '#181818', '#1f1f1f', '#ffffff', '#0078d4',
    ...['statusBar.background', 'statusBar.inactiveBackground', 'statusBar.noFolderBackground', 'statusBar.debuggingBackground'].map(id => theme[id])])]
    .map(parseHex).filter(color => color?.alpha === 1);
  const hoverToken = '--vscode-statusBarItem-hoverBackground';
  const activeToken = '--vscode-statusBarItem-activeBackground';
  for (const background of new Map(backgrounds.map(color => [hexOf(color.rgb), color])).values()) {
    // VS Code paints the bar through element.style.backgroundColor, rather
    // than consistent debugging/no-folder classes. Match its actual serialized
    // paint so another window/state cannot reuse the wrong theme correction.
    const root = `${bar}[style*="background-color: rgb(${background.rgb.join(', ')});"]`;
    const target = `${root} ${plain}`;
    css += `${target}:not(:hover):not(:active) { ${declarations(hexOf(background.rgb))} }\n`;
    // Modern UI compact entries paint an additional gradient on hover. Until
    // all layers can be verified, use their native foreground for that state.
    const hovered = `${root} > .items-container > ${item}:not(.compact-left):not(.compact-right) > .statusbar-item-label:not([style*="background" i])`;
    for (const [token, selector, candidates] of [
      [hoverToken, `${hovered}:hover:not(:active)`, overlays('statusBarItem.hoverBackground', ['#ffffff1f', '#0000001f'])],
      [activeToken, `${hovered}:active`, overlays('statusBarItem.activeBackground', ['#ffffff2e'])],
    ]) {
      // With no active paint, a simultaneous hover can still supply its own
      // background. Keep native foregrounds rather than assume transparency.
      const unpainted = token === activeToken ? `${selector}:not(:hover)` : selector;
      css += `@container not style(${token}) {\n${unpainted} { ${declarations(hexOf(background.rgb))} }\n}\n`;
      for (const [serialized, overlay] of candidates) {
        const painted = hexOf(overlay.rgb.map((value, i) => value * overlay.alpha + background.rgb[i] * (1 - overlay.alpha)));
        css += `@container style(${token}: ${serialized}) {\n${selector} { ${declarations(painted)} }\n}\n`;
      }
    }
  }
  return css;
}

module.exports = {renderStatusBarContrast};
