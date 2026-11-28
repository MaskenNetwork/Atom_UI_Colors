# Atom UI Colors

*Not affiliated with AtomMaterialUI or Microsoft.*

Add Atom Material colors to supported VS Code UI icons while keeping their original
shapes and sizes. Your file and folder icon theme stays unchanged.

![Atom UI Colors in VS Code](https://raw.githubusercontent.com/MaskenNetwork/Atom_UI_Colors/main/atom-ui-colors/media/screenshots/01-workspace.png)

## Installation integrity warning

After applying colors, VS Code may report **"Your Code installation appears to
be corrupt"** and show **[Unsupported]** in the title bar. This is expected:
Atom UI Colors modifies VS Code's `workbench.html` to load the icon colors, so
the file no longer matches Microsoft's original checksum. The warning concerns
the VS Code installation; it does not by itself mean your project files are damaged.

If you accept this customization, choose **Don't Show Again** in the notification's
actions to hide the warning for the current VS Code build. It may appear again
after a VS Code update, and the **[Unsupported]** title can remain visible.
Hiding the notification only dismisses the warning; this customization remains
unsupported by Microsoft. See the
[VS Code integrity warning FAQ](https://code.visualstudio.com/docs/supporting/faq#_installation-appears-to-be-corrupt-unsupported).

## Installation permissions

Atom UI Colors needs permission to create and replace files in the **VS Code
installation folder**, where it modifies `workbench.html`.

On Windows:

- **User Setup**, normally installed under
  `%LOCALAPPDATA%\Programs\Microsoft VS Code`, is usually writable by your user
  and allows the extension to work without administrator privileges.
- **System Setup**, normally installed under `C:\Program Files\Microsoft VS Code`,
  is usually protected. Applying colors can fail with `EPERM` or `EACCES` while
  creating a `workbench.html.<id>.tmp` file. This indicates a filesystem access
  restriction; the extension cannot bypass it.

For a personal installation, use
[VS Code User Setup](https://code.visualstudio.com/docs/setup/windows#choose-user-setup-or-system-setup)
to keep the installation writable by your user. If you keep System Setup, close
all VS Code instances, start VS Code with **Run as administrator**, then run
**Atom UI Colors: Apply / Repair Colors** and choose **Reload Window**.
You can return to normal launches afterward, but later color changes, automatic
refreshes, reapplication after VS Code updates, restoration and uninstall cleanup
also need write access and may require elevation again. On a managed computer,
contact your administrator if these permissions are unavailable.

## Use

Install the extension and choose **Reload Window** when prompted.
Colors refresh when your installed extensions or theme change; reload again
when prompted to display the changes.

## Customize

To change an individual color, add its icon ID and a `#RRGGBB` value to your
user settings:

```jsonc
{
  "atomUIColors.colors": {
    "search": "#80CBC4"
  }
}
```

`atomUIColors.viewColors` sets colors for supported extension view icons using
their view or view container IDs.
Set `atomUIColors.enabled` to `false`, then **Reload Window**, to turn the colors off.

Automatic activity bar and status bar icon colors are adjusted to reach at least **3:1 contrast**
against verified theme backgrounds. Readable colors stay unchanged; other colors
are lightened or darkened while preserving their hue where possible. Explicit
`colors` and `viewColors` overrides keep the exact color you chose.

Backgrounds are read from JSONC themes (including `include` files) and
`workbench.colorCustomizations`, including theme-specific overrides. CSS checks
the current window's theme tokens before using a correction, so a different
window or a theme change cannot reuse a correction for a different background.
When the background or an active/hover overlay cannot be verified, icons use the
theme's foreground for that state. This can also happen with unsupported theme
formats or layouts. Custom CSS that paints backgrounds independently of VS Code's
theme tokens is outside this check.

The status bar includes the notification bell and checks its actual background
in normal, debugging, empty and inactive windows. Hover and pressed backgrounds
are checked separately. Special entries (warning, error, remote, offline and
prominent), extension-painted backgrounds and unverified compact hover layers
use their native foregrounds so their icons follow the item's own colors.

Set `atomUIColors.activityBarContrast` or `atomUIColors.statusBarContrast` to
`false`, then **Reload Window**, to use the original automatic colors in that bar.
Both settings are enabled by default. The contrast feature uses CSS only and
does not change the Content Security Policy. Icons outside these bars retain
their existing color behavior; disabled icons and high-contrast themes keep
their defaults. Explicit icon color overrides can fall below the contrast target.

![Color settings](https://raw.githubusercontent.com/MaskenNetwork/Atom_UI_Colors/main/atom-ui-colors/media/screenshots/03-settings.png)

## Requirements

- Desktop VS Code **1.93.0 or newer**, in an installation writable by your user.

Compatible builds are verified against their original workbench checksum;
support is not restricted to one specific VS Code release. The original CSP
must allow the generated styles. Builds with incompatible policies or application
files modified by other tools may require restoring the original VS Code files
before applying colors.

The original Content Security Policy is preserved. Colors are shared by windows
using the same installation. Isolated webviews and native operating-system menus
are outside its coverage; disabled icons and high-contrast themes keep their defaults.

## Uninstall

Uninstall the extension normally. Atom UI Colors automatically removes its
changes when removal is detected. Wait for the **Reload Window** prompt, then
reload to return to the previous appearance. You do not need to run a restore
command before uninstalling.

If another VS Code profile still uses the extension, the shared colors remain
until the extension is removed from all profiles in that installation.

If no prompt appears or colors remain after reloading, fully quit and reopen
VS Code to allow uninstall cleanup to finish, then run **Developer: Reload Window**
if needed.

## Restore without uninstalling

Run **Atom UI Colors: Restore Previous Appearance**, then **Reload Window**.
Automatic color application stays paused until you run
**Atom UI Colors: Apply / Repair Colors**, then reload again.

## Support the Project

If you find this extension useful and would like to support me, consider making a donation.

[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=for-the-badge&logo=paypal)](https://paypal.me/maskennetwork)

## License

Released under the [MIT License](https://github.com/MaskenNetwork/Atom_UI_Colors/blob/main/atom-ui-colors/LICENSE). See [Third-party notices](https://github.com/MaskenNetwork/Atom_UI_Colors/blob/main/atom-ui-colors/THIRD_PARTY_NOTICES.md) for component and asset licenses.

[Source code on GitHub](https://github.com/MaskenNetwork/Atom_UI_Colors) · [Report an issue](https://github.com/MaskenNetwork/Atom_UI_Colors/issues)