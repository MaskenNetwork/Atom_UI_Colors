# Atom UI Colors

Keep VS Code's native UI icon shapes and apply Atom Material colors.
File and folder icon themes stay independent.

![Atom UI Colors in VS Code](atom-ui-colors/media/screenshots/01-workspace.png)

The extension source, screenshots, commands, requirements and restoration guide
are in [atom-ui-colors/README.md](atom-ui-colors/README.md).

## Repository layout

This repository root is the working copy connected to GitHub. Make changes here;
generated source exports and archived copies are not separate working copies.

| Path | Purpose |
| --- | --- |
| `atom-ui-colors/src/` | Extension runtime |
| `atom-ui-colors/assets/` | Palette, Codicon catalog and provenance |
| `atom-ui-colors/media/` | Marketplace icon and screenshots |
| `atom-ui-colors/vendor/` | Bundled dependencies and their licenses |
| `atom-ui-colors/test/` | Automated tests |
| `atom-ui-colors/scripts/` | Development packaging and catalog maintenance |
| `.github/workflows/` | CI for Windows, macOS and Linux |

Generated VSIX packages, local toolchains, recovery backups and publishing records
are excluded from Git. Keep recovery data until it is no longer needed.

## What changed in 0.1.3

Version 0.1.3 carries the prepared Marketplace metadata: the public author name
**MaskenNetwork**, GitHub source and issue links, and HTTPS screenshot URLs.
It also removes the Marketplace Preview label.
The first public 0.1.2 package used the earlier local packaging metadata.
The runtime, palette, icon sizes and behavior are unchanged from 0.1.2.

This extension uses Custom CSS and JS Loader and requires a writable desktop
VS Code installation. It can trigger VS Code's integrity warning. It does not
support VS Code for the Web or modify your file icon theme.

## Development

With Node.js 22 or later, run from the source directory:

```sh
cd atom-ui-colors
node --test
node scripts/package.cjs
```

The dependency-free package script creates a VSIX for local development in the
repository root. For Marketplace uploads, package with Microsoft's official tool
from the extension directory:

```sh
npx --yes @vscode/vsce@4.1.1 package --no-dependencies
```

Use that official package or the CI artifact for Marketplace releases.

GitHub Actions runs lifecycle tests on Windows, macOS and Linux. After they pass,
it builds a Marketplace VSIX with Microsoft's @vscode/vsce 4.1.1 and stores it as
the atom-ui-colors-marketplace workflow artifact. Publication to the Marketplace
is a separate action through the publisher account.

MIT licensed. See [third-party notices](atom-ui-colors/THIRD_PARTY_NOTICES.md).
Independent of Microsoft and AtomMaterialUI.
