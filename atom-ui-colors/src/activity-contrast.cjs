'use strict';
const {parseHex, hexOf, ensureContrast} = require('./contrast.cjs');
const variable = color => `--atom-ui-colors-contrast-${color.slice(1).toLowerCase()}`;
const token = id => `--vscode-${id.replaceAll('.', '-')}`;

function cssColor(color) {
  return color.alpha === 1 ? hexOf(color.rgb) : `rgba(${color.rgb.join(', ')}, ${+color.alpha.toFixed(2)})`;
}
function style(id, color) { return `style(${token(id)}: ${cssColor(color)})`; }
function missing(id) { return `(not style(${token(id)}))`; }
function opaque(value) { const color = parseHex(value); return color?.alpha === 1 ? color : null; }
function overlayColor(overlay, background) {
  // Match VS Code's CSS serialization (two decimal places for nonopaque alpha).
  const alpha = +overlay.alpha.toFixed(2);
  return hexOf(overlay.rgb.map((value, i) => value * alpha + background.rgb[i] * (1 - alpha)));
}
function renderActivityContrast(scope, colors, theme, fallback) {
  const unique = [...new Set(colors.map(color => color.toLowerCase()))].sort();
  if (!unique.length) return '';
  const vertical = ':is(.activitybar,.global-activity)';
  const top = ':is(.activitybar2,.part.sidebar>:is(.title,.header-or-footer)>.composite-bar-container>.composite-bar)';
  const item = '.action-item:not(.monaco-menu *)';
  const roots = [`${scope} ${vertical}`, `${scope} ${top}`];
  const reset = unique.map(color => `${variable(color)}: ${fallback};`).join(' ');
  let css = '/* Activity bar contrast: CSS-only guards use each window\'s live theme tokens. */\n';
  css += `${roots.map(root => `${root} ${item}`).join(',\n')} { ${reset} }\n`;
  // A menu opened from an activity item must not inherit its adjusted colors.
  css += `${roots.map(root => `${root} .monaco-menu`).join(',\n')} { ${unique.map(color => `${variable(color)}: initial;`).join(' ')} }\n`;
  css += `${scope} ${vertical} ${item}.checked { --atom-ui-colors-fallback: var(--vscode-activityBar-foreground, var(--vscode-icon-foreground, var(--vscode-foreground))); }\n`;
  css += `${scope}:not(.modern-ui) ${vertical} ${item}:not(.checked):hover { --atom-ui-colors-fallback: var(--vscode-activityBar-foreground, var(--vscode-icon-foreground, var(--vscode-foreground))); }\n`;
  css += `${scope}.modern-ui ${vertical} ${item}:not(.checked):hover { --atom-ui-colors-fallback: var(--vscode-modernActivityBarItem-hoverForeground, var(--vscode-activityBar-inactiveForeground, var(--vscode-icon-foreground, var(--vscode-foreground)))); }\n`;
  css += `${scope}.modern-ui ${vertical} ${item}.checked { --atom-ui-colors-fallback: var(--vscode-modernActivityBarItem-activeForeground, var(--vscode-activityBar-foreground, var(--vscode-icon-foreground, var(--vscode-foreground)))); }\n`;
  css += `${scope} ${top} ${item} { --atom-ui-colors-fallback: var(--vscode-activityBarTop-inactiveForeground, var(--vscode-panelTitle-inactiveForeground, var(--vscode-icon-foreground, var(--vscode-foreground)))); }\n`;
  css += `${scope} ${top} ${item}.checked { --atom-ui-colors-fallback: var(--vscode-activityBarTop-foreground, var(--vscode-panelTitle-activeForeground, var(--vscode-icon-foreground, var(--vscode-foreground)))); }\n`;
  css += `${scope} ${top} ${item}:not(.checked):hover { --atom-ui-colors-fallback: var(--vscode-activityBarTop-foreground, var(--vscode-panelTitle-activeForeground, var(--vscode-icon-foreground, var(--vscode-foreground)))); }\n`;

  const declarations = new Map();
  function rule(selector, condition, background) {
    let values = declarations.get(background);
    if (!values) {
      values = unique.map(color => `${variable(color)}: ${ensureContrast(color, background) || fallback};`).join(' ');
      declarations.set(background, values);
    }
    css += `@container ${condition} {\n${selector} { ${values} }\n}\n`;
  }
  function states(root, condition, background, activeToken, hoverToken) {
    const normal = `${root} ${item}:not(.checked)`;
    const normalCondition = hoverToken ? `${condition} and ${missing(hoverToken)}` : condition;
    if (hoverToken) {
      rule(`${normal}:not(:hover)`, condition, hexOf(background.rgb));
      rule(`${normal}:hover`, normalCondition, hexOf(background.rgb));
      const hover = parseHex(theme[hoverToken]);
      if (hover) rule(`${normal}:hover`, `${condition} and ${style(hoverToken, hover)}`, overlayColor(hover, background));
    } else rule(normal, condition, hexOf(background.rgb));
    rule(`${root} ${item}.checked`, `${condition} and ${missing(activeToken)}`, hexOf(background.rgb));
    const active = parseHex(theme[activeToken]);
    if (active) rule(`${root} ${item}.checked`, `${condition} and ${style(activeToken, active)}`, overlayColor(active, background));
  }
  // Candidates are never assumed to be defaults: every rule checks the actual
  // CSS variable. This also covers omitted registry defaults in built-in themes.
  const candidates = [...new Set(['#333333', '#2c2c2c', '#181818', '#ffffff',
    ...['activityBar.background', 'activityBarTop.background', 'sideBar.background',
      'editor.background', 'titleBar.activeBackground', 'titleBar.inactiveBackground',
      'modernActivityBar.background', 'modernActivityBar.inactiveBackground'].map(id => theme[id])])]
    .map(opaque).filter(Boolean);
  for (const background of candidates) states(`${scope}:not(.modern-ui) ${vertical}`, style('activityBar.background', background), background, 'activityBar.activeBackground');

  const topBackground = opaque(theme['activityBarTop.background']);
  if (topBackground) {
    states(`${scope}:not(.modern-ui-tabs) ${top}`, style('activityBarTop.background', topBackground), topBackground, 'activityBarTop.activeBackground');
  } else {
    for (const sidebar of candidates) states(`${scope}:not(.modern-ui-tabs) ${top}`, `${missing('activityBarTop.background')} and ${style('sideBar.background', sidebar)}`, sidebar, 'activityBarTop.activeBackground');
  }
  // Modern UI can use separate bar and item backgrounds. Unknown registry
  // defaults intentionally keep the foreground fallback instead of a guess.
  for (const background of candidates) {
    states(`${scope}.modern-ui.focused ${vertical}`, style('modernActivityBar.background', background), background, 'modernActivityBarItem.activeBackground', 'modernActivityBarItem.hoverBackground');
    states(`${scope}.modern-ui:not(.focused) ${vertical}`, style('modernActivityBar.inactiveBackground', background), background, 'modernActivityBarItem.activeBackground', 'modernActivityBarItem.hoverBackground');
  }
  return css;
}

module.exports = {variable, renderActivityContrast};
