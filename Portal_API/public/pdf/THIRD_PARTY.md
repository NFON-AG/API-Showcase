# Offline PDF export assets

These files support direct PDF downloads in the Portal app and its downloaded
static demo. They are served locally. Export does not depend on a CDN, a remote
conversion service, a browser installation on the server, or an npm install.

This is a narrow exception to the application's zero-runtime-dependency
convention: one pinned browser library is shipped for PDF serialization and
embedded-font support. The server still uses Node built-ins only. The app does
not use jsPDF's optional HTML, image-loading, or SVG-conversion integrations.

## jsPDF 4.2.1

- Upstream: https://github.com/parallax/jsPDF
- Source: https://registry.npmjs.org/jspdf/-/jspdf-4.2.1.tgz
- License: MIT; the unmodified upstream license is in `jspdf.LICENSE.txt`.
- Shipped file: unmodified `package/dist/jspdf.umd.min.js` from the npm tarball.
- npm tarball integrity:
  `sha512-YyAXyvnmjTbR4bHQRLzex3CuINCDlQnBqoSYyjJwTP2x9jDLuKDzy7aKUl0hgx3uhcl7xzg32agn5vlie6HIlQ==`
- Tarball SHA-256:
  `e97bd16e3211928442c631b20dcefa78a8e10dad8ccbe97160b89b214745603a`
- Bundle SHA-256:
  `e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54`

The tarball's SHA-512 integrity and SHA-1 checksum were both checked against the
official npm package metadata before extracting the bundle and license. Any
update should repeat those checks and the actual-download regression suite.

## Pangram Sans

`pangram-font.js` contains a static TrueType instance of the project's existing
owner-supplied, licensed `shared/assets/fonts/PPPangramSans-Variable.woff2`.
It is not a newly sourced or freely licensed typeface. The source notice remains
applicable:

> Proprietary typeface by Pangram Pangram. This file comes from the project
> owner's locally supplied licensed brand assets. It is not extracted from the
> Admin Portal. Its license is separate from the showcase source code; no
> general font redistribution rights are granted here.

The source font's copyright metadata reads: "Copyright © 2021 by Mathieu
Desjardins. All rights reserved." Its OS/2 `fsType` is `0x0008` (editable
embedding). That technical flag permits embedded editable document use; it
does not replace or broaden the project owner's separate font license.

The export instance fixes `wght=400` and `wdth=740` (the original width default),
retaining all 541 mapped characters. This covers the supported interface
languages and the routing arrow. The source font does not cover arbitrary
scripts such as CJK or Arabic; the exporter must detect unsupported characters
instead of silently dropping them.

### Rebuild

The development-only script `scripts/build-portal-pdf-font.py` converts the
existing local WOFF2 font. Run it with Python and `fonttools[woff]==4.60.1`;
`--check` verifies the committed JavaScript asset without modifying it. FontTools
and Python are not runtime dependencies. The output embeds font bytes in a
script so that the same asset works over HTTP and from `file://`.

- Source WOFF2 SHA-256:
  `eec9326cf9db2006d96d794dea33ebc114f245476f2422796bb75398bf6e47e1`
- Static TTF SHA-256:
  `cc77c269b3ae6e6b4d227d1053da997065e3605abd5318f2270a8b985cadf08e`
