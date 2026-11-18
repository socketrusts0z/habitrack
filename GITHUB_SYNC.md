# HabiTrack GitHub sync

Open **Data → GitHub sync → Connection settings** in the app.

1. Create a private data repository and initialize it with a README. Keep it separate from the public HabiTrack code repository.
2. Create an expiring fine-grained GitHub token limited to that repository, with **Contents: Read and write**. Paste it directly into the PWA.
3. Enter the private repository as `owner/name`, then click **Test connection**. This checks access without sending your logs. Optionally select **Remember token on this device** to store the token in browser storage. **Forget token** clears the local copy.
4. Click **Sync now** on the device with your complete history. The first incremental sync writes all months once. Each later sync writes only changed files. The snapshot link opens the index at the confirmed Git commit.

**Export** still downloads one complete local backup for **Import**. It excludes sync credentials and settings.

## GitHub format

`habitrack/index.json` contains schema version 2, the last changed snapshot timestamp, the local timezone, and a mapping from file paths to Git blob SHAs. `habitrack/settings.json` contains habit definitions and preferences, food definitions, and weekly snippets. `habitrack/logs/YYYY-MM.json` contains the dated habit, protein, and screen-time records for each month. Edited or removed records update their original month, and deleting a month's last record removes the month file in the current commit. Past Git commits can still contain removed records.

The index and changed files publish together in one non-forced commit. No data change means no commit. Readers should pin the commit or validate each file against the index. The legacy `latest.json` remains available after migration. Readers can use it when the index is absent. After migrating, reload any other open HabiTrack tabs before syncing again.

This sync mirrors the history on the device that uploads it. It does not merge devices. A device without a matching sync baseline can adopt an identical snapshot but cannot overwrite divergent data. If the first incremental sync sees different legacy data, return to the device with the previous sync state and the complete local history. Keep a full Export backup before reconciling differing devices.

Run `node tests/github-sync.test.cjs` from the repository root to check sync behavior against mocked GitHub responses.
