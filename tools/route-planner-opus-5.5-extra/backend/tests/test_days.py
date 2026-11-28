"""Automatic overnights: where each driving day ends (days.py, through schedule.plan)."""

from app.models import DaySettings, StopRef

from .fakes import box
from .phase4 import NO_MEALS, box_at, rows_of, run, town, towns, wp


def nights(out):
    return [r for r in rows_of(out, "overnight") if r["auto"]]


def test_a_long_drive_is_cut_into_days_within_the_limit():
    out = run([wp("a", 0), wp("b", 900)], towns(every=50))  # 15 h of driving
    assert len(nights(out)) == 1
    driving = [d["driving_minutes"] for d in out["days"] if d["driving"]]
    assert len(driving) == 2 and all(m <= 480 for m in driving)
    assert not [w for w in out["warnings"] if w["code"] == "day_over_limit"]


def test_days_are_balanced_rather_than_full_then_short():
    out = run([wp("a", 0), wp("b", 720)], towns(every=20))  # 12 h: 6 + 6, not 8 + 4
    (night,) = nights(out)
    assert 340 <= night["mile"] <= 380, night["mile"]


def test_a_prefer_zone_wins_a_close_call():
    cands = [town(1, 360, name="Plain"), town(2, 400, name="Liked")]
    plain = run([wp("a", 0), wp("b", 720)], cands)
    liked = run([wp("a", 0), wp("b", 720)], cands, zones=[box("p", *box_at(400), type="prefer", name="Liked")])
    assert nights(plain)[0]["name"] == "Plain"  # 6 h + 6 h is more even than 6 h 40 + 5 h 20
    night = nights(liked)[0]
    assert night["name"] == "Liked" and night["prefer"]
    assert night["moved"].startswith("⭐ prefer zone: instead of Plain")
    assert "short day: prefer zone" not in [c["text"] for d in liked["days"] for c in d.get("chips", [])]  # 6 h 20 is not short


def test_a_no_overnight_zone_rules_a_place_out_and_says_so():
    cands = [town(1, 300, name="Early"), town(2, 360, name="Middle"), town(3, 420, name="Late")]
    out = run([wp("a", 0), wp("b", 720)], cands, zones=[box("n", *box_at(360), type="no_overnight", name="Middle")])
    night = nights(out)[0]
    assert night["name"] != "Middle"
    assert night["moved"] == "moved from Middle: no-overnight zone"
    ruled = [a for a in night["alternatives"] if a["status"] == "ruled_out"]
    assert ruled and ruled[0]["name"] == "Middle" and ruled[0]["reason"] == "in the no-overnight zone “Middle”"
    assert out["zone_effects"]["n"] == [f"night on day 1 moved from Middle to {night['name']}"]


def test_user_overnights_stay_fixed_and_split_the_stretches():
    out = run([wp("a", 0), wp("n", 400, type="overnight"), wp("b", 800)], towns(every=20))
    assert nights(out) == []  # each day is 6 h 40: nothing to add
    assert [r["name"] for r in rows_of(out, "overnight")] == ["N"]


def test_an_over_limit_day_warns_and_names_the_alternative():
    # 8 h 20 in one day beats a 7 h 50 day plus a 30-minute one: the limit is soft.
    out = run([wp("a", 0), wp("b", 500)], [town(1, 470, name="Close")], meals=NO_MEALS)
    (warning,) = [w for w in out["warnings"] if w["code"] == "day_over_limit"]
    assert warning["message"] == "Day 1 has 8 h 20 of driving, over the 8 h 00 limit: Close would make it 7 h 50, but the trip would need another day."
    assert "over the 8 h 00 limit" in [c["text"] for c in out["days"][0]["chips"]]


def test_an_over_limit_day_with_nowhere_to_stay_says_so():
    out = run([wp("a", 0), wp("b", 600)], [town(1, 590, name="Edge")], meals=NO_MEALS)
    (warning,) = [w for w in out["warnings"] if w["code"] == "day_over_limit"]
    assert warning["message"].endswith("no place to stay (2 or more lodgings) within 8 h 00 of A.")


def test_stay_here_instead_pins_an_overnight():
    cands = towns(every=40)
    first = nights(run([wp("a", 0), wp("b", 800)], cands))[0]
    other = next(a for a in first["alternatives"] if a["status"] == "ok")
    pinned = run([wp("a", 0), wp("b", 800)], cands, pins=[StopRef(key=other["key"], name=other["name"], kind="overnight")])
    night = nights(pinned)[0]
    assert night["stop_key"] == other["key"] and night["pinned"] and night["reason"] == "pinned by you"


def test_skipping_an_overnight_picks_another_place():
    cands = towns(every=40)
    first = nights(run([wp("a", 0), wp("b", 800)], cands))[0]
    again = nights(run([wp("a", 0), wp("b", 800)], cands, skips=[StopRef(key=first["stop_key"], name=first["name"])]))[0]
    assert again["stop_key"] != first["stop_key"]


def test_too_little_lodging_is_not_a_place_to_stay():
    cands = [town(1, 360, lodging=1, name="Motel"), town(2, 300, name="Inns")]
    assert nights(run([wp("a", 0), wp("b", 720)], cands))[0]["name"] == "Inns"


def test_automatic_overnights_can_be_turned_off():
    out = run([wp("a", 0), wp("b", 720)], towns(), days=DaySettings(auto_overnights=False))
    assert nights(out) == [] and any(w["code"] == "day_over_limit" for w in out["warnings"])
