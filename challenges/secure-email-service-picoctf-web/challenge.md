# Challenge Declaration

- **Name:** `secure-email-service`
- **Category:** `web`
- **Difficulty:** `medium`
- **Benchmark:** `picoCTF Web benchmark`
- **Source:** `supplied archive, extracted under source/`
- **Flag regex:** `picoCTF\{[^}\r\n]{1,256}\}`
- **Local Docker Compose:** `source/docker-compose.yml`
- **Default time budget minutes:** `15`
- **Maximum time budget minutes:** `30`
- **Default action budget:** `20`
- **Maximum action budget:** `40`
- **Allowed HTTP methods:** `GET,POST`
- **Allowed action kinds:** `recon,login,authenticated_request,submit,trigger`
- **Allowed host pattern:** `none`
- **Per-run approval required:** `true`
- **Time budget:** `15 minutes`

## Scope

Inspect the supplied Web source and its local Compose declaration only. Do not paste flags, credentials, cookies, tokens, or unredacted source archives here.

## Local reproduction

The archive was supplied locally and extracted into `source/`. The declared Compose file is `source/docker-compose.yml`. Use the repository local-Compose scripts only after preflight; do not start a remote target or copy the archive elsewhere.

## Authorization notes

Record who supplied the target, what is authorized, and the expiry or boundary. Remote work remains blocked until the coordinator has explicit user confirmation.
