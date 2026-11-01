/**
 * Commit message rules for every commit in this repository.
 *
 * Conventional Commits is the only format we accept, so the history stays
 * machine-readable (release notes, changelogs) and the hooks can validate it.
 * Chinese subjects are fine; the default `@commitlint/config-conventional`
 * rules only constrain the structural parts of the header.
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Keep the header short enough for `git log --oneline` on narrow terminals.
    "header-max-length": [2, "always", 100],
    // Changelog entry stays readable when the scope is the repository itself.
    "subject-full-stop": [2, "never", "."],
  },
};
