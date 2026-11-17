# HabiTrack GitHub sync

The deployed GitHub Pages app is in `docs/`. Open its Data tab and expand GitHub sync settings.

1. Create a **private** repository, for example `socketrusts0z/habitrack-data`. Initialize it with a README so it has a default branch. Do not use the public HabiTrack source repository.
2. In GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens, create an expiring token restricted to that single repository. Grant repository **Contents: Read and write**. If an organization owns the repository, its approval policies may also apply.
3. Enter `owner/repository` and the token directly in the PWA. Never paste the token into ChatGPT or commit it to source control.
4. Leave “Remember token on this device” off to keep it only until reload/close. Selecting it stores the token in this origin's browser localStorage, accessible to JavaScript running on that origin. Forget token removes the local saved value; revoke the token on GitHub if it should stop working everywhere.
5. Click **Sync now to GitHub**. Success appears only after GitHub confirms the commit. The snapshot link points at that commit's `latest.json`.
6. Give the ChatGPT GitHub app access to the data repository, and verify it can fetch `latest.json`. Test a scheduled read before creating a weekly review; a working PWA upload does not establish scheduled ChatGPT access.

This is manual one-click upload, not background synchronization or multi-device merging. Each successful click replaces `latest.json` with this device's full snapshot. Use the device with your complete logs. Git history retains older versions, including deleted entries or notes. The token is used only for GitHub API calls, and sync settings are excluded from normal exports. The upload allowlist contains habit definitions/history/icons, hidden/default habit, protein/food records, screen-time records, and weekly snippets. Review those notes before uploading.

Snapshots contain schema version, UTC export timestamp, local IANA timezone and a `data` object. Missing records mean missing logs, not necessarily missed habits. The 750 KB snapshot limit keeps the file readable through the standard contents API. Offline uploads must be retried manually. Conflicts do not retry or overwrite silently; re-read the destination and retry intentionally. Unconfirmed network responses advise checking GitHub before retrying.

The PWA reads and writes GitHub's API directly; there is no backend and no embedded credential. An expired token, repository rules, or insufficient permissions can block uploads. Existing Export/Import continue to handle plain backup JSON; `latest.json` is a review snapshot with a wrapper, not a backup import file.

Validation: `node tests/github-sync.test.cjs`, `node --check docs/github-sync.js`, and `node --check docs/script.js`. Network requests are mocked by the regression checks; these do not establish live browser or scheduled connector access.

## Checking an upload

The sync status appears above the button and reports checking, uploading and verifying. Success means a second API read at the returned commit confirmed the file's SHA. “View snapshot” opens that exact committed file and remains available after reload. Check `exported_at` inside the file to confirm freshness.

Missing repository/token inputs now open Connection settings, focus the missing input and show a toast. The repository field is not prefilled: enter the actual `owner/name`. If “Loading sync controls” remains visible, scripts did not initialize; reopen/reload the updated app. Do not clear website data, because that also deletes locally stored logs. Versioned app assets ensure the service worker does not pair this UI with the old sync script.
