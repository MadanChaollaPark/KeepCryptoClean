# Dependency advisory register

Last reviewed: 2026-07-13

Owner: repository maintainer

Next review: 2026-08-13 or immediately when Koii publishes compatible updates

`yarn audit:production` and `yarn audit:all` fail on every high or critical
production or toolchain advisory. Yarn reports the lower-severity advisories
below through the current official Koii packages. They are not silently
suppressed: the checks print their path count, and release promotion remains
subject to this register.

| Advisory                                                                 | Severity | Current path/version                                      | Current exposure decision                                                                                                                                                                      |
| ------------------------------------------------------------------------ | -------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84) | Low      | Koii wrapper/web3 → secp256k1 → elliptic 6.6.1            | No patched elliptic release is identified by the advisory. The task does not call attacker-selected ECDH operations. Keep the package at the newest compatible 6.x and replace when Koii does. |
| [GHSA-5v7r-6r5c-r473](https://github.com/advisories/GHSA-5v7r-6r5c-r473) | Moderate | task-manager → Orca/Nest → file-type 20.4.1               | Vulnerable ASF parsing is in the unused Orca/Nest extension graph. The task accepts no file upload and exposes only health locally. A fix requires file-type 21 and upstream compatibility.    |
| [GHSA-j47w-4g3g-c36v](https://github.com/advisories/GHSA-j47w-4g3g-c36v) | Moderate | task-manager → Orca/Nest → file-type 20.4.1               | ZIP inspection is not invoked by this task; no upload route exists. A compatible upstream major is required.                                                                                   |
| [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) | Moderate | task-manager → Orca → Nest core 10.4.22                   | The affected Nest response path is in an unused extension dependency. Container ingress is localhost-only and health returns fixed JSON. Nest 11 is an upstream breaking change.               |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Moderate | Koii web3/Jayson uuid 8.3.2; task-manager/Orca uuid 9.0.1 | The affected v3/v5/v6 caller-supplied-buffer APIs are not used; these packages use generated IDs. Forcing uuid 11 across Koii packages is a breaking override, so await upstream.              |

Compensating controls are narrow because the affected Orca upload/server
features are not imported by the task entrypoint. If a future change enables an
Orca extension, file upload, arbitrary Nest response rendering, UUID buffer
API, or ECDH call, these exceptions expire immediately and the change must not
merge until patched.

The lockfile also pins compatible patched transitives for previously high or
critical advisories (`secp256k1`, `elliptic`, `base-x`, `debug`, `minimatch`,
`multer`, `lodash`, `ws`, `cross-spawn`, `flatted`, `js-yaml`, and `ajv`). The
previous deployment CLI was removed rather than carrying its vulnerable
toolchain. Remove a resolution only after confirming the upstream range
resolves to an equal or newer safe version and rerunning the full testnet
release gate.
