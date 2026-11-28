"""Check each audited year adds up: revenue lines = opRev, opRev - opExp = opInc, and
opInc + nonoperating + capital = change in net position. Prints anything off by more than 2 (rounding)."""
import json, glob, sys
bad = 0
for f in sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 else "*.json")):
    d = json.load(open(f))
    for y, v in sorted(d["years"].items()):
        g = lambda k: v.get(k) or 0
        checks = {
            "opRev": g("npsr") + g("supp") + g("premium") + g("oopOther") - g("opRev"),
            "opInc": g("opRev") - g("opExp") - g("opInc"),
            "chg": g("opInc") + g("tax") + g("relief") + g("invest") + g("interest") + g("otherNonop") + g("cap") + g("transfer") - g("chg"),
        }
        for k, diff in checks.items():
            if abs(diff) > 2:
                bad += 1; print(f, y, k, "off by", diff)
print("ok" if not bad else f"{bad} problems")
