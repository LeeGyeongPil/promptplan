# Changelog

## 0.1.1 - 2026-11-11

### Fixed

- `plan` and `apply` now fail (exit code 1) when `--dir` exists but holds no prompt files (`.md`, `.yaml`, `.yml`; hidden files, `node_modules` and `README.md` do not count), instead of reporting "No changes" and exiting 0. This was a known limitation in 0.1.0. If you relied on an empty folder to list every remote prompt as "Not in your files", that run now exits 1.

### Known limitations in 0.1.1

- The "prompt folder not found" error does not show the path you passed and reports its location as `.`.
- With `--format json`, remote prompts are still listed under `unmanaged` even when the run has errors.

## 0.1.0 - 2026-11-10

First release.

- `plan`: compares a folder of prompt files with Langfuse and shows what would be created, versioned or relabelled (text, markdown for PR comments, json). `--detailed-exitcode` exits 2 when there are changes.
- `apply`: creates a new version only when the content changed; otherwise moves labels. Safe to run again (idempotent).
- `pull`: writes the prompts that carry a label (default `production`) to files.
- Warnings for removed variables, added placeholders and drift (a version made outside promptplan). Drift is reported, never overwritten.
- `mock` and `demo`: a practice mock of the Langfuse prompt API so everything can be tried without an account.
- Example GitHub Actions workflow in `examples/github-actions/promptplan.yml`.

### Known limitations in 0.1.0

- Error messages for a missing `--dir` folder or `--mock-state` file do not include the path you passed.
- The `plan` summary line does not pluralise ("2 label move", "0 new version").
