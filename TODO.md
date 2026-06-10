# TODO list

1. Add a way to paste in a git repo like <https://github.com/pewdiepie-archdaemon/odysseus.git> or pewdiepie-archdaemon/odysseus instead of the path (must be a public repo for this to work)
2. Add a way to sort by column on Contributors tab, one click will make it descending and another click will make it ascending with an accompanying SVG triangle pointing down and up to represent the direction it is sorted.
3. If a contributor does not have a name field or name is blank, show the email instead (truncate long names + email but allow for user to see the full name on hover)
4. Add playwright testing
5. Remove lines option from `Contribution Graph` chart
6. Add a --user flag that will show all commits for that user
   7.1 We would need to change the dashboard to allow filtering by repository (default show all history across all commits)
   7.2 This would show all public commits but we should add a --token flag where a user passes in a GitHub token to see all their private repo commits as well
7. Add a --pdf flag that will just give the user the all time PDF (using the same --file flag for the path otherwise make the PDF in that repo folder with the same timestamp format)
8. Make sure all the available flags are in the -h output with appropriate descriptions
9. Add a loading spinner when tabs are loading
   9.1 Also use the loading spinner when generating the PDF and prevent clicking and scrolling on webpage
   9.2 i suppose we dont to load anything on the page itsef when exporting
10. I can't actually type in a date in the custom date range, it will reset all fields as soon as I try to input a 3rd field
11. on export PDF it maintains the dark background for charts, lets make it consistent use the light theme for the exportw
12. Setting range to Custom then trying to export PDF will break the charts (showing blank charts) but they work fine on the HTML

| Group                   | Items                                                                        | Theme                               |
| ----------------------- | ---------------------------------------------------------------------------- | ----------------------------------- |
| **A — CLI features**    | #1 (paste URL), #6 (--user/--token), #7 (--pdf), #8 (-h output)              | New CLI flags + remote repo support |
| **B — UI enhancements** | #2 (sort columns), #3 (name fallback + truncation), #5 (remove lines option) | Dashboard UX polish                 |
| **C — Testing**         | #4 (Playwright)                                                              | New test framework                  |
