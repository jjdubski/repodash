# TODO list

1. Add a way to paste in a git repo like <https://github.com/pewdiepie-archdaemon/odysseus.git> or pewdiepie-archdaemon/odysseus instead of the path (must be a public repo for this to work)
2. Add a --json flag to give all the default insights as JSON instead of serving the webpage
3. Add a way to sort by column on Contributors tab, one click will make it descending and another click will make it ascending with an accompanying SVG triangle pointing down and up to represent the direction it is sorted.
4. How is `commit by hour of day` chart calculated? Is it adjusted to match the user's local time or does it use UTC time?
5. Add interactive CLI flags
   5.1 Add a -h or --help flag to show all options
6. Add timing with steps like (loading git history, building webpage etc.) that can be enabled with the --timing flag (disabled by default)
7. If a contributor does not have a name field or name is blank, show the email instead (truncate long names + email but allow for user to see the full name on hover)
8. Issue with the `Commit Distribution` chart, it does not show the tooltip when hovering over the bars (check the logic)
9. Add playwright testing
