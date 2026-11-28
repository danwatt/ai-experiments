#!/usr/bin/env python3
"""Pull the legislative history of a Texas bill: text, amendments, and every record vote.

    uv run tx_lege.py https://legiscan.com/TX/drafts/SB17/2025
    uv run tx_lege.py SB17 --session 89R
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from txlege.build import assemble
from txlege.fetch import Fetcher, FetchError
from txlege.output import write_all
from txlege.tlo import parse_bill_arg

HERE = Path(__file__).resolve().parent


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bill", help="SB17, 'HB 2', a LegiScan URL, or a capitol.texas.gov URL")
    ap.add_argument("--session", help="TLO session code: 89R (regular), 891/892 (called sessions). "
                    "Inferred from the year in a LegiScan URL.")
    ap.add_argument("--out", type=Path, default=HERE / "output", help="output directory (default: ./output)")
    ap.add_argument("--cache", type=Path, default=HERE / ".cache", help="HTTP cache directory")
    ap.add_argument("--refresh", action="store_true", help="ignore the cache and re-download")
    ap.add_argument("--members", type=Path, help="extra members CSV (name,chamber,party,district) for party data")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    try:
        bill = parse_bill_arg(args.bill, args.session)
    except ValueError as exc:
        ap.error(str(exc))

    fetcher = Fetcher(args.cache, refresh=args.refresh, verbose=not args.quiet)
    try:
        record = assemble(fetcher, bill, args.members)
    except (FetchError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    out_dir = args.out / bill.slug
    paths = write_all(record, out_dir)
    n_rc = len(record["rollcalls"])
    n_am = len(record["amendments"])
    print(f"{bill.session_label} {bill.label}: {len(record['actions'])} actions, {n_am} amendments, {n_rc} record votes")
    for p in paths:
        print(f"  {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
