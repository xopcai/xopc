# Trusted proxy auth

Use when an OAuth-aware reverse proxy (Caddy, nginx, Pomerium) terminates TLS and authenticates users.

## Gateway config

```json5
{
  gateway: {
    bind: "loopback",
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-forwarded-user",
        allowLoopback: true,
      },
    },
    trustedProxies: ["127.0.0.1"],
  },
}
```

## Caddy (sketch)

```txt
gateway.example.com {
  reverse_proxy 127.0.0.1:18790 {
    header_up X-Forwarded-User {http.auth.user.id}
  }
}
```

## nginx (sketch)

```nginx
location / {
  auth_request /oauth2/auth;
  auth_request_set $user $upstream_http_x_auth_request_email;
  proxy_set_header X-Forwarded-User $user;
  proxy_pass http://127.0.0.1:18790;
}
```

Block direct access to port `18790` from the internet; only the proxy should reach the gateway.

See [network.md](../network.md).
