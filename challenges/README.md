# Challenges

Each challenge directory is created with `scripts/new_challenge.sh <safe-slug>` and must contain `challenge.md`, `notes.md`, `artifacts/`, `exploits/`, and `source/`.

`challenge.md` is the declaration and authorization boundary. `notes.md` is for sanitized reasoning only. Generated content is ignored by default; do not place flags, secrets, cookies, tokens, logs, source archives, or final exploit payloads in tracked files.

Set category to `web`, `pwn`, `reverse`, or `surprise`. A surprise challenge is triaged generically and cannot add a skill without user approval. Set target authorization explicitly before any interaction; `local-only` is the safe template default.

For the local Docker workflow, set `Target authorization: local-only`, `Remote status: local-only`, `Target: local-source-only`, and replace `Local Docker Compose: none` with a relative Compose file inside the challenge directory. The lifecycle scripts reject absolute paths, traversal, URLs, symlinks, and missing files.
