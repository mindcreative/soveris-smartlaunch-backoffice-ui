# Repository working agreements

## External test evidence storage

- For Business and all `soveris-smartlaunch-*` repositories, use the canonical policy in `/home/soveris/Projects/soveris-smartlaunch-infrastructure/docs/evidence-storage.md` and its `scripts/evidence/` commands.
- Generated test archives belong outside Git: primary `/home/soveris/.local/share/soveris-evidence`, backup `/mnt/gold2/soveris-evidence` on GOLD2 UUID `24CE9E8FCE9E593E`. Keep source, executable tests, fixtures, runners, concise results, member indexes, source/build identities, failed/successor provenance and open gates in Git.
- Publish only completed, quiescent runs. Require the actual GOLD2 mount, two size/SHA-256-verified copies and actual backup restoration before removing repository archive copies. Keep original archive bytes and per-run/member identity; use `.external.json` descriptors and update exact evidence/File List links. No formatting, force mounting, NTFS repair, other HDD partition changes or ADATA access is authorized by this policy.
- If GOLD2 is unavailable/unclean, retain originals and durable pending output under the primary store's `pending/` directory, mark `PENDING BACKUP`, and do not claim migration or backup completion. Do not stage new evidence archives or bypass Git hooks. Source-only work can continue.
- Install/reinstall local pre-commit/pre-push checks using Infrastructure `scripts/evidence/install.py` in new clones; preserve prior hooks including Git LFS. Existing Git history/LFS objects require a separate coordinated cleanup; this policy authorizes no commits, pushes, deployments or history rewrites.
- Existing Codex sessions must explicitly reread updated guidance; tmux reattachment alone does not reload it. Configuration and scripts are shared on this server and read on each invocation.
