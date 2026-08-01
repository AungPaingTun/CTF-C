# Challenge Declaration

- **Name:** `stage2-web-fixture`
- **Category:** `web`
- **Difficulty:** `easy`
- **Target authorization:** `remote-authorized`
- **Target:** `authorized-target`
- **Remote status:** `remote-authorized`
- **Authorized remote actions:** `declared-bounded-actions`
- **User approval record:** `approved`
- **Local Docker Compose:** `none`
- **Authorized:** `true`
- **Remote actions allowed:** `true`
- **Target URL:** `http://127.0.0.1:__PORT__`
- **Allowed hosts:** `127.0.0.1`
- **Allowed HTTP methods:** `GET,POST`
- **Allowed action kinds:** `recon,login,authenticated_request,submit,trigger`
- **Time budget minutes:** `15`
- **Action budget:** `20`
- **Flag regex:** `picoCTF\{[^}\r\n]{1,256}\}`
- **Time budget:** `15 minutes`

## Scope

This is a deterministic loopback-only execution fixture.
