# TODO list

1. Add a way to paste in a git repo like <https://github.com/pewdiepie-archdaemon/odysseus.git> or pewdiepie-archdaemon/odysseus instead of the path (must be a public repo for this to work)
2. Add playwright testing
3. Add a --user flag that will show all commits for that user
   7.1 We would need to change the dashboard to allow filtering by repository (default show all history across all commits)
   7.2 This would show all public commits but we should add a --token flag where a user passes in a GitHub token to see all their private repo commits as well
4. Add a --pdf flag that will just give the user the all time PDF (using the same --file flag for the path otherwise make the PDF in that repo folder with the same timestamp format)
5. Make sure all the available flags are in the -h output with appropriate descriptions
6. Find a good npm package name: git-graph, reposcan, repo-scan, repo-vitals, git-vitals
7. Make `Commit by Day of Week` and `Commit by Hour of Day` share a page in export PDF (stacked vertically preferably)
8. Perhaps some system information checking to dynamically adjust concurrent from 8 -> 4

| Group                | Items                                                           | Theme                               |
| -------------------- | --------------------------------------------------------------- | ----------------------------------- |
| **A — CLI features** | #1 (paste URL), #3 (--user/--token), #4 (--pdf), #5 (-h output) | New CLI flags + remote repo support |
| **B — Testing**      | #2 (Playwright)                                                 | New test framework                  |
