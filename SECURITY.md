# Security Policy

YFRemote lets a paired device type, move the mouse, start apps, read the clipboard, and shut
down a PC. A flaw in how it decides *who* may do that matters, so reports are very welcome.

## Supported versions

Only the **latest release** receives security fixes. There are no backports to older versions;
a fix ships as a new release, which installed copies pick up through the tray's automatic
update check.

| Component | Supported |
| --- | --- |
| Windows (installer / Velopack, latest release) | Yes |
| Linux x64/arm64 (`-beta` channel, latest release) | Best effort |
| Android server app (APK from the latest release) | Best effort |
| Older releases, self-built or modified copies | No |

## Reporting a vulnerability

**Please do not open a public issue, discussion, or pull request for a security problem.**

Report it privately through GitHub instead:
[**Report a vulnerability**](https://github.com/YannikFroehlich/YFRemote.Server/security/advisories/new)
(repository tab *Security* → *Advisories* → *Report a vulnerability*).

Helpful to include:

- the affected version and platform (Windows, Linux, Android) and whether HTTPS was enabled,
- what an attacker needs beforehand (same network only? a paired device? a "Nur Medien" device?),
- steps or a small proof of concept to reproduce it,
- the impact you see and, if you have one, a suggested fix.

YFRemote is maintained by one person in their spare time, so responses are best effort. The
aim is to acknowledge a report within a week, keep you updated in the advisory, and publish a
fix as soon as one is ready. Once the fix is released, the advisory is published and you are
credited unless you prefer not to be.

## Scope

YFRemote is designed for a **trusted private network**. Reaching the port alone must not be
enough to control the PC: every action endpoint requires a device token obtained with the
6-digit PIN shown in the tray. Details are on the
[Security](https://github.com/YannikFroehlich/YFRemote.Server/wiki/Sicherheit) wiki page.

In scope, for example:

- sending input or using any `Bearer`-token endpoint without being paired, or with a revoked or
  expired token,
- bypassing the PIN lockout, guessing or leaking PINs or device tokens,
- a "Nur Medien" device performing an action outside the media allowlist,
- bypassing the `Origin` checks (e.g. a website in the device's browser driving the server),
- path traversal or overwriting files through `POST /files` or `GET /files/{id}`,
- the `launch` action starting anything other than a listed app or an `http`/`https` URL,
- reaching Voicemeeter or `pactl` beyond the allowed parameters,
- exposure of the local certificate authority's private key or of `devices.json`,
- tampering with the update path (GitHub Releases / Velopack feed).

Out of scope:

- anything a paired device with full access can already do by design (it can type, use the
  mouse, and shut down the PC — that is the product),
- forwarding port `5050`/`5443` to the internet or otherwise exposing YFRemote outside a trusted
  network, which the README advises against,
- eavesdropping on the plain-HTTP connection when HTTPS is switched off,
- certificate warnings when the local CA is not installed on the device,
- attacks that require local administrator rights or physical access to the PC,
- flooding the server from the local network (each connection is rate-limited as a backstop,
  but denial of service on the LAN is not treated as a vulnerability),
- vulnerabilities in third-party dependencies without a demonstrated impact on YFRemote — please
  report those to the respective project.
