# Hermes Crash Recovery — Queued Prompts

Saved: 2026-06-18 00:05:40

Source: `C:/Users/musas/AppData/Local/hermes/profiles/lambenti/state.db`

Selection rule: TUI sessions with `message_count = 1` and the sole message role `user` — likely prompts queued/started before the crash and not answered.

Count: 13

## Run-now status — 2026-06-18 09:39 EDT

- The 23:45 scheduled resume job was removed (`76a240ff00eb`) and the recovered tasks were run/verified immediately.
- Current-tree verification confirms the newest tracking/accounting prompts are implemented; no additional code changes were required in this run.
- Evidence: targeted tests passed (8 files / 53 tests), typecheck passed, lint passed, full serial Vitest passed (75 files / 353 tests), 6144 MB build passed, HTTP smoke passed (21 pages / 5 UI contracts / 4 JSON APIs / 3 CSV exports), browser-section smoke passed (21 pages), local tracking duplicates were 0, and live Ship24 duplicate active tracking numbers were 0.
- Safety: run-now verification performed no stock, purchasing, accounting posting/payment, Alibaba capture/import, delivery confirmation, or supplier-message side effects.

## Recovery status — 2026-06-17 19:18 local

- Active Hermes background jobs: none recovered from this chat/process manager at start; the in-app terminal was not open. Follow-up correction: Hermes-tracked `npm run start:local` wrappers can exit while the spawned Next `node` child remains alive; current app listener is PID 5680 on `127.0.0.1:5173`, and `/tracking` + `/accounting` HTTP checks returned 200.
- Current inventory-app repo had a large verified-but-uncommitted working tree and no `TASK_QUEUE.md` item marked in progress.
- Resumed the two newest one-message prompts below first because they were the only June 17 unanswered crash-recovery prompts.
- Prompt #1 current-tree status: source and browser evidence show open-shipment details after `Shipment progress` are collapsed, delivered-history full data is behind a disclosure, the removed delivered-row sentence is absent, provider heartbeat has a countdown ring/progress bar, local tracking rows have no duplicates, and live Ship24 reports 5 active trackers / 5 unique active tracking numbers / 0 duplicate active tracking numbers.
- Prompt #2 current-tree status: source and browser evidence show `Accounting Workbench`, no old `Simple accounting command center`, `Command Center`, daily-bookkeeping links to sections/pages, the three bottom accounting guidance panels are collapsed, OCR retry/manual paste controls exist, and full app browser smoke passes.
- Verification run during recovery: targeted Vitest tracking/accounting/OCR suite passed (4 files / 24 tests), `npm run typecheck` passed, `npm run lint` passed, `npm run test:serial` passed (75 files / 350 tests), `npm run build` passed, `npm run smoke -- --base-url=http://127.0.0.1:5173` passed (21 pages / 5 UI / 4 JSON APIs / 3 CSV exports), and `npm run smoke:browser -- --base-url=http://127.0.0.1:5173` passed (21 pages).

## 1. 2026-06-17 23:47:38 — session `20260617_184733_dd4568` / message `31976`

```text
In the open shipments section, collapse the information after the shipment progress line. The delivered tracking history section, when expanded shows gray boxes around the full package tracking data entry. Remove "Delivered rows are retained as history and are not polled. Carrier status remains shipment metadata only." In the provider heartbeat section, add a visual countdown until update. Make the Live graphic actively represent the progress until refresh.

Make sure that there exist no duplicates being tracked on the SHIP24 API as only 10 tracking numbers are allowed at a time. This must be done automatically to ensure that the service is not unnecessaily clogged. Change
```


## 2. 2026-06-17 23:40:13 — session `20260617_184005_20b57e` / message `31975`

```text
Capitalize the w in Accounting workbench. Remove the description. Change Simple accounting command center to Command Center. When clicking on the sections underneath bookeeping routine, make it jump to the associated page or section.  All bills and entries must be referring to unique orders, or merged into the same entry if from a different source. Avoid duplicates and design a system that automatically detects and merges duplicates.

Collapse the "Canadian GST/HST and audit-ready records", "Invoice functionality upgrades active here", "Accounting control trail". Move them to the same line at the bottom of the page. Every title in each card, across the entirety of this inventory app, capitalize the first letter.

The OCR read function is not reading the PDF contents. Fix.

Make sure that all clickable sections on this page actually are clickable and lead to somewhere.
```


## 3. 2026-06-15 11:40:48 — session `20260615_064043_30922d` / message `26883`

```text
Research ways to make the accounting section more functional and simple. Look at what accounting apps do. Replicate as best you can. Everything has to work flawlessly
```


## 4. 2026-06-15 06:03:06 — session `20260615_010300_68d95d` / message `25356`

```text
Compact session_search by default File: tools/session_search_tool.py Add parameters like: detail: "compact" | "full" include_tool_calls: false default max_chars_per_message discovery_window bookend_count Default discovery should return title, snippet, 1–2 nearby messages, and IDs for follow-up scrolling. Strip or summarize tool_calls; preserve tool names, status, and maybe argument hashes. Make skill_view() progressive-disclosure by default File: tools/skills_tool.py Current behavior returns full content. Add: mode: "brief" | "full" default brief: frontmatter, trigger conditions, top headings, linked files, and first ~2–4 KB. explicit mode:"full" only when needed. Also update agent/prompt_builder.py skill instructions to say: load brief first, then a specific reference/full skill only if needed. Defer more core tool schemas Files: model_tools.py, tools/tool_search.py Tool Search currently defers MCP/plugin tools, but core Hermes tools are never deferred. Add “core progressive disclosure”: always-on: terminal, read_file, search_files, patch, todo, clarify deferred unless needed: cronjob, delegate_task, browser/media/image/video/tts/kanban/messaging. This could save several thousand tokens every model call. Add deterministic tool-output compactors Targets: terminal/process outputs, build/test logs, browser snapshots, session search. For common commands: npm run build: return pass/fail, route count, errors/warnings, and tail only. vitest/pytest: return summary, failures, slow tests, tail. git diff --stat: OK; full diffs only when asked. Store full raw output in a temp log file and return a path/handle if needed. Lower default tool-output caps for this profile Current: tool_output.max_bytes: 60000 tool_output.max_lines: 2500 Better Lambenti default: max_bytes: 20000–30000 max_lines: 600–1000 Use explicit full-log retrieval when necessary. Relevance-gate memory/context injection Keep user preferences always. Inject project memories only when workdir/session topic matches. For AGENTS.md, inject an outline + critical rules first; require file read for the rest. The current CONTEXT_FILE_MAX_CHARS = 20_000 is still large for every session. Redact/summarize large historical tool-call arguments during compression Patch calls and write calls preserve huge old_string/new_string payloads in transcript. Compression should retain: file path operation type result status diff hash / concise diff summary Drop bulk arguments once the tool result/diff is recorded. Add a token governor Track cumulative tool-result chars and tool-call count per session. When thresholds are crossed: auto-suggest or auto-run /compress checkpoint to repo state files recommend /new after verified completion switch to compact tool-output mode. Use narrow toolset sessions for routine tasks For simple repo work, start with only: terminal,file,skills,todo,session_search Add browser/delegation/cron/media only when actually needed. This can cut schema overhead immediately without code changes. Use local delegates/scripts to summarize noisy data For large diffs/logs, route first-pass summarization to local Qwen or deterministic scripts, then feed Hermes only the compact result. Parent still verifies critical outcomes. Make all of the necessary changes except the ones that would prematurly terminate a long session. Make your entire system more efficient and accurate, head to toe
```


## 5. 2026-06-14 23:56:19 — session `20260614_185614_1ea6a5` / message `23894`

```text
I ran the capture function, then it clicked on the delivering section, opened the available tracking pages, went to the completed & in review section, clicked on each order, but failed to find the track order lines further down the page, repeated this cycle a few times, went to the logistics services section which is not required, then went back to orders, failed to open messages. Make sure that the tracking numbers are actually being saved and recognized. Make sure that no repeat actions are done when the system recognizes that there already exists a saved tracking number for that order element.
```


## 6. 2026-06-14 22:16:08 — session `20260614_171602_d1d916` / message `23719`

```text
The capture tracking function still rechecks stale data. Make sure that it forms a memeory of what was already checked or not. When navigating elements, tracking data will be found when elements on the screen that say "Track Package" or "Track Shipment(s)" is clicked. Sometimes there will be several layers of these buttons to click in different areas of the page until the tracking number is retrieved. When the function reaches the completed and in review section, it skips several entries. Make sure that it makes its first pass and gathers the tracking data from previous orders. The most important goal is to prevent rechecks of stale entries.
```


## 7. 2026-06-14 14:48:05 — session `20260614_094759_4c0f32` / message `21584`

```text
Make sure that capture tracking button pulls this page and reads all messages, saving anything that is pertinent to shipping and tracking from eac individual message section

[Image attached at: C:\Users\musas\AppData\Roaming\Hermes\composer-images\composer_2026-06-14_13-47-22-413_2c0d42.png]
[screenshot]
```


## 8. 2026-06-14 12:18:12 — session `20260614_071805_eb4aa6` / message `20694`

```text
Make sure that the Capture alibaba tracking activates the automatic alibaba login and tracking collection function, saving discovered tracking numbers. Ship24 is not configured, make sure that it is. Take all necessary steps. If you require input from me, let me know. Use subagents for research, delegate to the local LLM, use all resources at your disposal. Do what the most powerful and efficient process would call for, then review the improvements illuminated by this process, and save to memory to replicate in the future.

[Image attached at: C:\Users\musas\AppData\Roaming\Hermes\composer-images\composer_2026-06-14_11-14-50-453_994b47.png]
[screenshot]
```


## 9. 2026-06-14 00:15:02 — session `20260613_191457_a7e403` / message `19106`

```text
The LED strips are showing that they have no set supplier again, after they have been saved with the appropriate supplier manually. Find out what is causing the supplier to not save. Fix all issues and test.
```


## 10. 2026-06-09 22:46:28 — session `20260609_174626_de40be` / message `17488`

```text
When inputting a preferred supplier from the dropdown box in the edit items page, the supplier does not save. Fix. Add the option to delete source documents in the accounting page.

The following notice is produced on the dashboard page, "Review order 303671327001023166
2 unmatched/uncertain line(s) need catalog matching before all effects are safe". The email and associated items ware matched manually, why does this notice appear?

For suggested purchase orders, do not make suggestions for finished goods, these have to be assembled and not purchased. The function of this notice is not necessary.

Make the archive supplier button more simple and minimalist. Remove the Outer yellow box.

Research and implement ways to make the alibaba login, read message, scrape order information, get tracking information functional. It is a requirement to use the Work chrome profile that I am already signed into. Alibaba often uses a slide captcha, determine if it is possible to navigate around it. Eventually, this alibaba login function will be used to automatically place orders with suppliers, so it is necessary. Get creative with your problem solving. You got this.
```


## 11. 2026-06-08 03:38:37 — session `20260607_223836_2575cc` / message `13221`

```text
The autodetection of multiple items is still missing one entry. Check how to automatically determine multiple entries from the LED email. Check that the reassess button works by applying the advanced image detection to determine any missed entries. The reassess button should automatically grab data and update the entries if new data is available. Research the best way to implement an adaptive reasoning model that uses context to assign information to the correct fields. Implement whatever is necessary.
```


## 12. 2026-06-08 02:54:46 — session `20260607_215445_92af81` / message `12880`

```text
Independent pre-commit code review of the current staged Lambenti inventory app diff. Do not modify files. Review the staged diff for security concerns and blocking logic errors only. Return ONLY valid JSON with this schema: {"passed": boolean, "security_concerns": string[], "logic_errors": string[], "suggestions": string[], "summary": string, "commands_run": string[]}. Fail closed: if any security_concerns or logic_errors are non-empty, passed=false.
```


## 13. 2026-06-08 01:52:21 — session `20260607_205220_0592d6` / message `12593`

```text
Independent final blocker-only code review of the current uncommitted Lambenti inventory app working tree. Do not modify files. Return passed true/false, blockers with concise file/line evidence, non-blocking notes, commands run, and one-sentence summary.
```
