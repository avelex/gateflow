# Gateflow web

The merchant console and the public checkout (`/pay/<invoice>`), as one Vite + React app. The relay serves the built `dist/` and the API from one origin.

## Commands

```sh
npm ci
npm run dev     # http://localhost:5173, proxies /console and /checkout to the relay on 8787
npm test        # Vitest, node environment
npm run build   # type-check, then write dist/
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `VITE_NEAR_NETWORK` | `testnet` | Network for the checkout's NEAR wallets |

The page reads the Gateflow contract account from `GET /checkout/invoice`. Checkout links use the page's own origin.

## Merchant keys and the hostname

A merchant's key is derived from their passkey, and passkeys are bound to the site's hostname (the WebAuthn `rp.id`). The same passkey gives the same key only on the same hostname. Moving the app to another domain needs the recovery phrase (fallback keys) or a new merchant account.
