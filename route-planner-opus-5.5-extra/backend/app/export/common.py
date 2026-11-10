"""What the three exports share: cutting a plan into its driving days."""

from ..planner.picker import hm  # noqa: F401  (re-exported: "1 h 30")

# Rows that are places to go to, not notes: these become GPX waypoints and Google stops.
PLACE_TYPES = ("start", "through", "break", "lunch", "dinner", "fuel", "stop", "overnight", "end")
# A planned stop of the road (as opposed to a waypoint the user set).
PLANNED_STOPS = ("break", "lunch", "dinner", "fuel")


def driving_days(plan: dict) -> list[dict]:
    return [d for d in plan["days"] if d["driving"]]


def day_rows(plan: dict, day: dict) -> list[dict]:
    """The rows of one driving day, from where it starts to where it ends (both included).

    A day starts at the start or at the overnight the day before ended at
    (that row's depart_day is this day) and ends at the next overnight or
    the end.
    """
    rows = plan["rows"]
    n = day["day"]
    first = next(i for i, r in enumerate(rows) if r["depart_day"] == n and r["type"] in ("start", "overnight"))
    last = next(i for i in range(first + 1, len(rows)) if rows[i]["day"] == n and rows[i]["type"] in ("overnight", "end"))
    return rows[first : last + 1]


def day_title(plan: dict, day: dict) -> str:
    return f"Day {day['day']} · {day['start']} → {day['end']}"


def selected_days(plan: dict, only: list[int] | None) -> list[dict]:
    days = driving_days(plan)
    return [d for d in days if only is None or d["day"] in only]


def slug(text: str) -> str:
    out = "".join(c.lower() if c.isalnum() else "-" for c in text).strip("-")
    while "--" in out:
        out = out.replace("--", "-")
    return out or "trip"
