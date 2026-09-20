# OrbitFS Release Control Panel

## Goal
Turn the static GitHub page into a responsive owner-only control panel that dispatches the existing Base and Engine GitHub Actions workflows and monitors them live.

## Build
- Recreate the supplied dark operations interface at `/`, refined for desktop and mobile.
- Add secure owner sign-in without a separate profile record.
- Connect Base Deployment to `release-to-license-master.yml` with version, channel, notes, validation, and confirmation.
- Connect Release Update to `publish-engine-release.yml` with version, channel, APEX/MCP/Studio selection, minimum protocol, minimum Base version, notes, changed files, validation, and confirmation.
- Draft release notes from recent repository commits and changed files.
- Show combined Base and Engine workflow activity with automatic refresh, manual refresh, clear statuses, run details, GitHub log links, and retry actions.
- Include concise release-stage and connection/authority reference sections from the original panel.

## Safety
- Keep GitHub credentials server-side.
- Require an authenticated owner for every GitHub read and write, not only for the visible page.
- Confirm each workflow dispatch and retry before sending it to GitHub.
- Validate all submitted values and only allow the two configured repositories/workflows.

## Verification
- Exercise sign-in protection and GitHub-backed reads.
- Verify forms, validation, confirmation dialogs, refresh, logs, and retry behavior.
- Check the finished panel at desktop and mobile sizes.
