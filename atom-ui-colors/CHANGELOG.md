# Changelog

## 0.2.5

- Improve automatic activity bar icon colors to reach at least 3:1 contrast against verified backgrounds, preserving hue where possible.
- Use the current theme's foreground when backgrounds or state overlays cannot be verified, including after a theme change and in other windows.
- Read JSONC theme includes and global/theme-specific color customizations; preserve explicit icon color overrides.
- Add an Activity Bar Contrast setting. Keep the original CSP and the existing CSS-only integration unchanged.

## 0.2.4

- Fix an uninstall observer startup race that could miss immediate removal and intermittently fail macOS lifecycle tests.

## 0.2.3

- Clarify the installation write permissions required on Windows, including User Setup, System Setup and administrator access for protected installations.

## 0.2.2

- Support compatible VS Code releases beyond the bundled build catalog by verifying the original workbench against its distribution checksum.
- Reverify saved originals before reapplying or removing colors, and report the detected build when verification fails.
- Update the Marketplace description with automatic uninstall instructions and an explanation of VS Code's integrity warning.
- Remove the search screenshot.
- Fix verified build lookup for application paths containing directory links, including macOS temporary paths.

## 0.2.1

- Remove applied colors automatically when uninstall is detected, with a Reload Window prompt.
- Keep colors during updates and while another profile still uses the extension.

## 0.2.0

- Preserve VS Code's original Content Security Policy when applying colors.
- Improve restoration and uninstall cleanup.
