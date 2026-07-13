# Third-party notices

KeepCryptoClean includes third-party software. The project-level MIT license
does not replace the licenses of those components.

## Executable inventory

Every production build derives an attribution inventory from the modules in the
final `dist/main.js` chunk, rejects non-Node external modules, and emits the full
text as `dist/THIRD_PARTY_BUNDLE_NOTICES.txt`. The same digest-bound text is
embedded exactly once at the end of `dist/main.js`. The 135 reviewed application
package identities are pinned in `LICENSES/bundle-identities.txt`; Webpack's
build-generated runtime is recorded separately. An unreviewed graph, notice
source, README extraction, or identity drift fails the build.

The executable records the canonical source repository, exact release commit,
pinned Node/Yarn toolchain, lockfile, local dependency-patch script, and rebuild
instructions. Candidate builds may say `UNRECORDED - RELEASE BLOCKED`; public
distribution requires a 40-character commit and `yarn verify:licenses:release`.

## Unresolved Koii notices

The exact npm releases `@_koii/namespace-wrapper@1.0.23` (ISC),
`@_koii/storage-task-sdk@1.2.8` (MIT), and `@_koii/task-manager@1.0.14` (ISC)
declare licenses but ship no authoritative full license/copyright notice. Their
current and historical npm tarballs do not provide a notice that can safely be
reconstructed. Files under `LICENSES/unresolved/` preserve authenticated package
provenance and the missing-notice finding; they are not replacement licenses.

These packages are locally modified by `scripts/patch-task-manager.js`. Public
release is blocked until the publishers supply corrected releases or immutable
notices covering these exact versions, or legal counsel records an explicit
version/integrity/gitHead/patch-set-bound exception. The strict license gate
fails while this remains unresolved.

`bs58@4.0.1` and `tr46@0.0.3` also omitted full text from their exact release
tarballs. Their hash-pinned clarification files use full MIT notices from their
authenticated upstream repositories and are reviewed separately under
`LICENSES/clarifications/`.

## rpc-websockets 7.11.2

`@_koii/web3.js` brings `rpc-websockets` into the single-file Koii executable.
It is copyright Elpheria j.d.o.o. and licensed under
LGPL-3.0-only. Its package notice is reproduced in
[`LICENSES/rpc-websockets-LICENSE.txt`](LICENSES/rpc-websockets-LICENSE.txt),
the complete LGPLv3 text is included at
[`LICENSES/LGPL-3.0.txt`](LICENSES/LGPL-3.0.txt), and the GPLv3 terms it
incorporates are included at [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt).
Those texts come from the SPDX license-list data and are hash-checked by the
release gate.

The library is not modified by this repository. Its exact source is available
from the [rpc-websockets 7.11.2 npm package](https://www.npmjs.com/package/rpc-websockets/v/7.11.2)
and [upstream repository](https://github.com/elpheria/rpc-websockets). The
complete KeepCryptoClean source, lockfile, and Webpack configuration needed to
rebuild or relink the executable are in this repository. Replace the compatible
library source, run the pinned install/build commands in `README.md`, and verify
the resulting artifact as described in `docs/RELEASE.md`.

Public distribution of `dist/main.js` remains gated on an operator/legal review
of the exact LGPL obligations and distribution channel. This notice is not
legal advice and must not be removed from a distributed artifact.
