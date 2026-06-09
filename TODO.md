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
