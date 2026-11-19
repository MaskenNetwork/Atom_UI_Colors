# Third-party notices

The Atom Material color palette is derived from Atom Material Icons 210.0.2,
by Elior “Mallowigi” Boukhobza / AtomMaterialUI, MIT licensed:
https://github.com/AtomMaterialUI/a-file-icon-idea

Copyright (c) 2015-2024 Elior "Mallowigi" Boukhobza

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Microsoft jsonc-parser 3.3.1 is vendored under `vendor/jsonc-parser` with its
original MIT license. It preserves JSONC comments and unrelated settings during
offline uninstall cleanup. Source: https://github.com/microsoft/node-jsonc-parser

The downloaded npm archive SHA-256 was:
`4a0315b8671e7463bae7af7c142cdf19e9aa7ba39eb36dc2df383b8648e3cbc9`.

Custom CSS and JS Loader (`be5invis.vscode-custom-css`) is a separately installed
dependency, not bundled or reimplemented here. Its own license and documentation
apply: https://github.com/be5invis/vscode-custom-css

This extension is independent of AtomMaterialUI and Microsoft.

## Codicon catalog

`assets/codicons.json` is derived from Microsoft's VS Code Codicon registration
sources at commit `69047191fc`. The original MIT license is included as
`assets/codicons-LICENSE.txt`. Source files:
https://github.com/microsoft/vscode/blob/69047191fc/src/vs/base/common/codiconsLibrary.ts
https://github.com/microsoft/vscode/blob/69047191fc/src/vs/base/common/codicons.ts

## SVG renderer

The unmodified JavaScript binding and WebAssembly renderer from
`@resvg/resvg-wasm` 2.6.2 are included under `vendor/resvg-wasm`.
Copyright (c) 2021-present, yisibl and contributors.
These files are covered by the Mozilla Public License 2.0, included in that
directory as `LICENSE`. The corresponding source code is available at:
https://github.com/yisibl/resvg-js/tree/v2.6.2
https://github.com/yisibl/resvg-js/archive/refs/tags/v2.6.2.tar.gz

The downloaded npm archive SHA-256 was:
`ff51acbb5ee0074601b75c3bea9226a18d346752af787f6d2d3adcdd98493d71`.
The extension's own source remains MIT licensed; the renderer's original files
retain their MPL-2.0 terms. SVG analysis works offline and needs no native binary
for a particular operating system or processor.

The verified workbench HTML baselines in `assets/workbench-baselines.json` are
from Microsoft Visual Studio Code 1.147.0. Copyright (C) Microsoft Corporation.
The upstream workbench source is part of the MIT-licensed vscode repository:
https://github.com/microsoft/vscode
https://github.com/microsoft/vscode/blob/main/LICENSE.txt
The original copyright comment is retained. These baseline records are data;
no Microsoft application script or Loader script is shipped or injected by them.
