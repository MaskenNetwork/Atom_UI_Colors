# Atom UI Colors

Keep VS Code's native UI icon shapes and apply Atom Material colors.
File and folder icon themes stay independent.

![Atom UI Colors in VS Code](atom-ui-colors/media/screenshots/01-workspace.png)

The extension source, screenshots, commands, requirements and restoration guide
are in [atom-ui-colors/README.md](atom-ui-colors/README.md).

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

GitHub Actions runs lifecycle tests on Windows, macOS and Linux. After they pass,
it builds a Marketplace VSIX with Microsoft's @vscode/vsce 4.1.1 and stores it as
the atom-ui-colors-marketplace workflow artifact. Publication to the Marketplace
is a separate action through the publisher account.

MIT licensed. See [third-party notices](atom-ui-colors/THIRD_PARTY_NOTICES.md).
Independent of Microsoft and AtomMaterialUI.
