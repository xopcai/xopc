# Desktop Gateway selection

The desktop has one main window, preload and Endpoint host for both local and remote Gateways.
The bundled React application is served from the desktop transport's loopback origin. The
transport forwards API requests and realtime connections to exactly one selected Gateway;
remote servers do not supply Electron application code.

Selection lives in `userData/desktop-gateway.json`. Remote credentials use OS keychain
encryption. The renderer receives a transport session credential, and requests use an
HttpOnly loopback cookie. The main process supplies the selected Gateway credential upstream.
Upstream cookies and redirects are not inherited by the renderer. Upstream HTML is sandboxed.

The existing `DesktopEndpointHost` registers its tools with the selected Gateway and serves
native invocations through its realtime connection. Remote identities are scoped to Gateway
origins. Local computer access policy remains client-owned and survives switching. Remote
workspace paths cannot be opened as local filesystem paths or local terminals.

A switch validates the target, stops native work and terminal sessions, disconnects old HTTP
and realtime requests, activates the new target and reloads the same main window. A remote
startup does not start the embedded local Gateway. When a remote server is unavailable, the
bundled connection settings remain usable in the main window. Local Gateway process ownership
remains separate from selection: switching never stops an independently managed server.

Run `node scripts/verify-electron-local-connection.mjs` after building Node, Web and Electron
artifacts. It exercises two real Gateways, one window, native Endpoint registration,
encrypted credential persistence, switching back, restart and offline recovery in isolated
state directories. It does not invoke a paid model or native computer actions.
