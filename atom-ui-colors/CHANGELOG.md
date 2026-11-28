# Changelog

## 0.2.6

- Adjust automatic status bar icon colors, including the notification bell, to reach 3:1 contrast against verified light and dark backgrounds while preserving hue where possible.
- Track the actual status bar background across debugging, empty and inactive windows; account for verified hover and active overlays.
- Keep native item foregrounds for unknown or individually painted backgrounds, semantic status entries and compact hover layers. Preserve explicit icon overrides.
- Add an independent Status Bar Contrast setting, enabled by default, with browser coverage for all palette icons and theme/state changes.

- Keep automatic activity bar icon colors during Modern UI hover and selection when state backgrounds inherit from modernTab or list theme colors and registry defaults.
- Verify inherited backgrounds against live CSS tokens before adjusting contrast; retain the theme foreground for unknown backgrounds and preserve explicit color overrides.

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
