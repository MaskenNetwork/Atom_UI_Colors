# Changelog

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
