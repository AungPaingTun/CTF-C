# Expected Audit

- **Finding category:** Reflected user-controlled display data reaches an HTML response without context-appropriate output encoding.
- **Affected file path:** `tests/fixtures/web-source-audit/source/app.js`
- **Trust boundary:** `request.query.q` is request-controlled input crossing into `response.send()` HTML rendering.
- **Acceptable hypothesis wording:** `A query-controlled value reaches HTML rendering without output encoding and should be checked as a reflected output-handling issue.`

The audit must remain source-only and must not submit input, start a service, contact a target, or produce an exploit payload.
