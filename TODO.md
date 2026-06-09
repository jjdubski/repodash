# TODO list

1. Add a way to paste in a git repo like <https://github.com/pewdiepie-archdaemon/odysseus.git> or pewdiepie-archdaemon/odysseus instead of the path (must be a public repo for this to work)
2. Add a way to sort by column on Contributors tab, one click will make it descending and another click will make it ascending with an accompanying SVG triangle pointing down and up to represent the direction it is sorted.
3. How is `commit by hour of day` chart calculated? Is it adjusted to match the user's local time or does it use UTC time?
4. If a contributor does not have a name field or name is blank, show the email instead (truncate long names + email but allow for user to see the full name on hover)
5. Issue with the `Commit Distribution` chart, it does not show the tooltip when hovering over the bars (check the logic)
6. Add playwright testing
7. Remove lines option from `Contribution Graph` chart
8. Add a --user flag that will show all commits for that user
   8.1 We would need to change the dashboard to allow filtering by repository (default show all history across all commits)
   8.2 This would show all public commits but we should add a --token flag where a user passes in a GitHub token to see all their private repo commits as well
9. Trying to Export PDF for extremely large repo on the `All Time` range causes website to crash (presumably because of all the contributors causing hundreds of pages) perhaps we can switch to a better way to make a PDF / make it downloadable instead of using print
   9.1 Add a --pdf flag that will just give the user the all time PDF (using the same --file flag for the path otherwise make the PDF in that repo folder with the same timestamp format)
10. Make sure all the available flags are in the -h output with appropriate descriptions

| Group                   | Items                                                                        | Theme                               |
| ----------------------- | ---------------------------------------------------------------------------- | ----------------------------------- |
| **A — CLI features**    | #1 (paste URL), #8 (--user/--token), #9.1 (--pdf), #10 (-h output)           | New CLI flags + remote repo support |
| **B — Bug fixes**       | #5 (tooltip not showing), #9 (PDF crash on large repo)                       | Defects needing repair              |
| **C — UI enhancements** | #2 (sort columns), #4 (name fallback + truncation), #7 (remove lines option) | Dashboard UX polish                 |
| **D — Questions**       | #3 (timezone for hour chart)                                                 | Needs investigation, not code       |
| **E — Testing**         | #6 (Playwright)                                                              | New test framework                  |
