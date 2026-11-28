![Atom UI Colors](atom-ui-colors/media/icon.png)

# Atom UI Colors

Add Atom Material colors to supported VS Code UI icons while keeping their original
shapes and sizes. File and folder icon themes stay unchanged.

[Install from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=maskennetwork.atom-ui-colors) · [User guide](atom-ui-colors/README.md) · [Changelog](atom-ui-colors/CHANGELOG.md)

![Atom UI Colors in VS Code](atom-ui-colors/media/screenshots/01-workspace.png)

## Features

- **Color familiar icons**: Apply Atom Material colors to supported VS Code UI icons without changing their shapes or sizes.
- **Keep your file icon theme**: File and folder icons stay under the control of your existing icon theme.
- **Adapt to light and dark backgrounds**: Automatic activity bar and status bar colors target at least 3:1 contrast against verified backgrounds, including supported hover and active states.
- **Choose your own colors**: Override individual icon and extension view colors. Explicit overrides keep the exact color you choose.
- **Restore the previous appearance**: Use the restore command or uninstall normally. Cleanup removes this extension's changes; reload when prompted.

## Installation

1. Open [Atom UI Colors on the Marketplace](https://marketplace.visualstudio.com/items?itemName=maskennetwork.atom-ui-colors) and install it in VS Code.
2. Choose **Reload Window** when prompted to display the colors.
3. To reapply the colors, run **Atom UI Colors: Apply / Repair Colors** from the Command Palette, then reload when prompted.

Requires desktop VS Code **1.93.0 or newer** and a writable VS Code installation.
See the [user guide](atom-ui-colors/README.md) for permissions, customization,
contrast behavior and uninstall instructions.

Atom UI Colors modifies VS Code's `workbench.html`, which can trigger the
**installation appears to be corrupt** warning and an **[Unsupported]** title.
The original Content Security Policy is preserved. Read the
[installation integrity explanation](atom-ui-colors/README.md#installation-integrity-warning)
before applying the customization.

Extension ID: `maskennetwork.atom-ui-colors`.

## Development

The extension source is in `atom-ui-colors/`. CI uses Node.js 22 and checks the
extension on Linux, macOS and Windows.

```bash
cd atom-ui-colors
npm test
npx --yes @vscode/vsce@4.1.1 package --no-dependencies
```

The last command creates an installable VSIX without publishing it. Browser
tests can also be enabled by setting `ATOM_UI_COLORS_BROWSER` to a local
Chromium or Edge executable before running the tests.

## Contributing

Bug reports and pull requests are welcome. [Open an issue](https://github.com/MaskenNetwork/Atom_UI_Colors/issues)
with your VS Code version, theme, operating system and steps to reproduce the
problem. Run the tests before submitting code changes.

Atom UI Colors is an independent project and is not affiliated with
AtomMaterialUI or Microsoft.

## Support the Project

If you find this extension useful and would like to support me, consider making a donation.

<p>
  <a href="https://paypal.me/maskennetwork">
    <img src="https://img.shields.io/badge/Donate-PayPal-blue?style=for-the-badge&logo=paypal" alt="Donate via PayPal">
  </a>
</p>

## License

This project's source code is released under the [MIT License](LICENSE).
Third-party components and assets retain their respective licenses; see
[Third-party notices](atom-ui-colors/THIRD_PARTY_NOTICES.md).
