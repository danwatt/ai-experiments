# tx-lege

Pull the full legislative history of a Texas bill: every action from filing to
signing, each version of the bill text, every floor amendment, and every record
vote with how each member voted. Then see who voted for which amendments, who
crossed party lines, and who stuck with the sponsor.

```bash
uv run tx_lege.py https://legiscan.com/TX/drafts/SB17/2025
uv run tx_lege.py SB17 --session 89R
uv run tx_lege.py "HB 2" --session 892      # 89th Legislature, 2nd called session
```

Open `output/89R-SB17/report.html` in a browser.

## Where the data comes from

LegiScan blocks scripted access to its web pages, and its API needs a key, so
this goes to the official sources LegiScan itself uses:

| What | Source |
|---|---|
| Actions, captions, authors, sponsors | Texas Legislature Online bill history (`capitol.texas.gov/BillLookup/History.aspx`) |
| Bill text, every version | TLO `Text.aspx` and the `tlodocs/.../billtext/html` files |
| Floor amendments and their text | TLO `Amendments.aspx` |
| Roll calls, member by member | House and Senate journals (HTML editions), linked from each history action |
| Party and district | Legislative Reference Library member search, per Legislature |

Everything downloaded is cached in `.cache/`; use `--refresh` to re-download.

## Output

`output/<session>-<bill>/`:

- `report.html`: a self-contained report with the timeline, amendments, each
  record vote, a member-by-vote matrix, party defections, voting blocs, bill
  text and journal excerpts.
- `timeline.md`: the same sequence of events as plain Markdown.
- `rollcalls.csv`: one row per record vote, with the party split.
- `votes.csv`: one row per member per vote (long format, good for pandas or a spreadsheet).
- `vote_matrix_house.csv`, `vote_matrix_senate.csv`: members by votes.
- `text/`: each bill version as text (one paragraph per line), plus a unified
  diff against the previous version. `{+text+}` is language added to current
  law, `[-text-]` is language struck. The report shows the same comparisons
  GitHub-style: paragraph by paragraph, changed words highlighted, unchanged
  stretches folded, plus one diff from the filed version to the final one.
- `amendments/`: each floor amendment's text.
- `bill.json`: everything above in one structure.

## Reading the votes

- **Motions to table.** Most House amendments die on a motion to table, so a
  Yea on that vote is a vote *against* the amendment. The amendments table
  flips these, so its "for / against" columns are about the amendment itself.
- **"With sponsor"** compares each member to the bill's lead author in the
  chamber where it was filed and its lead sponsor in the other chamber.
- **"With party"** compares each member to the majority of their own party on
  that vote. Present-not-voting and absences don't count either way.
- **Senate voice votes.** The Senate often adopts amendments by voice vote and
  prints "All Members are deemed to have voted Yea ... except as follows",
  then lists the dissenters. Those are recorded here as votes (marked
  "voice, deemed") using that day's roll call.
- **Statements of vote.** House members can say afterward that they meant to
  vote differently ("I was shown voting yes. I intended to vote no."). These
  are attached to the vote and starred in the matrix, but the official tally
  is what's counted.
- **Reused record votes.** The House sometimes suspends its rules to apply one
  record vote to a long run of amendments. Those amendments point to the
  record vote that was applied.

## Limits

- Votes come from the journals' HTML editions, which start in the mid-2000s
  (both the current format and the older one used before 2013 are handled;
  tested back to the 82nd Legislature, 2011). Earlier journals are scanned
  PDFs only; votes from a journal with no HTML edition are skipped with a warning.
- Committee votes are counts only (TLO doesn't publish who voted how in committee).
- Party data comes from the LRL roster for the bill's Legislature. If a name
  can't be matched it shows party `?`; add rows to a CSV
  (`name,chamber,party,district`) and pass it with `--members`.

## Tests

```bash
uv run --group dev pytest
```
