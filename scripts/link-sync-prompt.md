Collect Link (link.orangelogic.com) data for the customer named "{{customerName}}" for the QA dashboard. Today is {{today}}.

You are running unattended. Use only the read-only Link tools you have (load them with ToolSearch, e.g. query "+link"). Start with GetQuerySyntaxGuide / GetSearchCapabilities if you need the search syntax. Never create, update, comment on, or bid on anything in Link.

Return two things:

1. `tasks`: Link tasks (tickets) for this customer that had activity in the last 14 days ({{since}} to {{today}}). For each unique task:
   - `taskPath`: the task's path/title as Link shows it
   - `taskType`: the task's subtype (Defect, Question, Configuration, …), or null
   - `status`: the task's current status
   - `totalMinutes`: integer minutes logged on the task, or null if unavailable
   - `teams`: team name(s) as one comma-separated string, or null
   De-duplicate by task ID. Return an empty array if there are none.

2. `fields`: the customer's own account/profile record in Link (the customer record that the customer's tasks belong to, e.g. via a task's parent), as a flat object of field name → value, verbatim, no curation. Return null if you cannot find the customer record with confidence. Do not guess: a record for a different customer is worse than null.

An approach that has worked before (go straight to it; only explore further if it fails):
- Customer record: SearchAssets with `DocSubType:Customer AND Title:"{{customerName}}"`. Its folder is `Root/Orange Logic/Clients/{{customerName}}`.
- Tasks: search scoped to that customer record (SearchInContainer), `DocType:Project`, EditDate within the 14-day window. Status is `CoreField.Status`, time is `Document.CumulatedTimeSpentHrs` (convert hours to minutes), team is `Document.AssignedToDpt`.
- EditDate is noisy: bulk/automated sweeps touch hundreds of old tickets at once (clusters of near-identical timestamps). Exclude those, and exclude process subtasks (QA, Smoke Test, Minor Update, Merge Request Execution, Meetings, Administrative Tasks).
- Fields: use ListRetrievableFields for the `customer` namespace and fetch those on the customer record; include only non-empty values.

Set `notes` to one or two sentences on how you found the data, or why something is missing.
