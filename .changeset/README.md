# Changesets

Add one Changeset for each user-visible feature, fix, or improvement. A Changeset becomes a separate card in the What's new timeline when its version is released.

Create a markdown file in this directory with YAML frontmatter naming `mylesnet-finance-tracker` and a `major`, `minor`, or `patch` bump. Put a short user-facing title on the first body line, a blank line, then a concise description of the user benefit.

- Use `minor` for a backward-compatible feature.
- Use `patch` for a fix or small improvement.
- Use `major` for a breaking change.

Do not edit `CHANGELOG.md` for an ordinary feature pull request. The release workflow creates a reviewed version pull request that adds each Changeset as an individual versioned card. Preview deployments show the pending version as upcoming; only a production deployment of the versioned commit counts as a release.
