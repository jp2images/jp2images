## GitHub Stats

<p align="center">
  <img src="./assets/github-stats.svg" alt="Jeff Patterson's GitHub stats" width="860">
</p>

<sub>This card is a static SVG regenerated nightly by a <a href=".github/workflows/stats.yml">GitHub Action</a> using GitHub's own API — no third-party service, so it always loads.</sub>

---

### Counting private contributions

By default the Action uses the built-in token, which only sees **public** data. To
include private contributions (the purple "private" line and private-repo languages),
add a personal access token as a repo secret named `STATS_TOKEN`:

1. Create a **fine-grained** token at <https://github.com/settings/tokens?type=beta>
   — "Only select repositories" → all, with **read-only** access to *Contents* and
   *Metadata*. (A classic token with the `repo` scope also works.)
2. Add it as a secret (you'll be prompted to paste the value — it is never stored in
   the repo):

   ```sh
   gh secret set STATS_TOKEN --repo jp2images/jp2images
   ```

3. Re-run the workflow: **Actions → Generate GitHub stats card → Run workflow**.

**Optional, for an accurate per-type breakdown:** GitHub lumps all private activity
into a single anonymized count, so the "Commits (this year)" line stays public-only
until you enable *Settings → Public profile → "Include private contributions on my
profile."* With that on, the commit/PR counts include private work too.
