# Changelog

## 0.1.3

- Remove the Marketplace Preview label and use explicit HTTPS screenshot URLs in the source README.
- Publish the prepared Marketplace metadata with the public author name MaskenNetwork, GitHub source and issue links, and HTTPS screenshot URLs.
- Keep the runtime, palette, native icon sizes and behavior unchanged from 0.1.2.

## 0.1.2

- Preserve the native 16px SVG drawing size inside padded toolbar buttons instead of enlarging masks to the full button box.
- Preserve native left alignment for custom tree and quick-pick SVG icons.
- Verify rendered SVG bounds against the original background image, including padded buttons and non-square SVGs.

## 0.1.1

- Apply explicit theme-color fallbacks to unmapped Codicons and extension view masks.
- Resolve missing Codicon aliases from the official library, installed editor and extension contributions while preserving explicit palette colors.
- Discover extension SVG colors from visible rendered area; break ties in document order and fall back to the current theme when no intrinsic color is available.
- Remove historical hard-coded extension SVG colors and refresh automatically after extension and theme changes.
- Color SVG toolbar backgrounds with the same SVG as an alpha mask, preserving native element dimensions and layout.
- Bundle an offline SVG renderer and test automatic refresh, SVG color extraction and fallback behavior.

- Rename the extension, commands, settings group and output channel to Atom UI Colors.
- Add an original Marketplace icon and screenshots of the real VS Code interface.
- Use the final package name `atom-ui-colors` and ID `maskennetwork.atom-ui-colors`.
- Rename commands/settings to `atomUIColors.*`, recovery storage to
  `~/.atom-ui-colors/`, and CSS markers to `ATOM-UI-COLORS`.
- Document cleanup and color preference transfer from earlier local builds.

## 0.1.0

- Keep the active native/product icon shapes and apply Atom Material colors.
- Generate per-profile CSS, merge the Loader imports, and run its apply command.
- Preserve file/folder icon themes, unrelated CSS, JSONC comments, and later edits.
- Add automatic repair after editor updates, restore command, and uninstall hook.
