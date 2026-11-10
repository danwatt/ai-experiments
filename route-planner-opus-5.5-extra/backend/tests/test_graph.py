"""The cheapest-path break chooser on hand-made nodes (graph.py)."""

from app.planner.graph import LEVELS, Node, Rules, cheapest_path, gap_cost, plan_segment, share

RULES = Rules()  # every 120 min or 150 mi, window 75-100 %, hard max 110 %


def nodes(*minutes, end, **kw):
    """Start at 0, a node at each minute, the end at `end`. 60 mph, so mile == minute."""
    out = [Node(0, 0)] + [Node(m, m, **kw) for m in minutes] + [Node(end, end)]
    return out


def stops(ns, path):
    return [ns[i].minute for i in path[1:-1]]


def test_short_segment_needs_no_break():
    ns = nodes(30, 60, 90, end=110)
    assert stops(ns, cheapest_path(ns, RULES)) == []


def test_dense_candidates_land_every_gap_inside_the_window():
    ns = nodes(*range(10, 600, 10), end=600)
    path, level = plan_segment(ns, RULES)
    times = [0] + stops(ns, path) + [600]
    gaps = [b - a for a, b in zip(times, times[1:])]
    assert level == 0
    assert all(90 <= g <= 120 for g in gaps[:-1]) and gaps[-1] <= 132
    assert len(times) - 2 == 4  # 600 min of driving: four breaks, not more


def test_sparse_candidates_use_the_late_side_rather_than_break_the_hard_max():
    ns = nodes(60, 125, 250, end=300)
    path, level = plan_segment(ns, RULES)
    assert level == 0 and stops(ns, path) == [125, 250]


def test_no_candidates_at_all_relaxes_to_one_long_drive():
    ns = nodes(end=300)
    assert cheapest_path(ns, RULES) is None
    path, level = plan_segment(ns, RULES)
    assert path == [0, 1] and LEVELS[level] == "gap past the hard maximum"


def test_a_long_empty_stretch_only_stretches_that_gap():
    # Stops every 100 min, then nothing between 300 and 470.
    ns = nodes(100, 200, 300, 470, 570, end=640)
    path, level = plan_segment(ns, RULES)
    assert level == 2 and stops(ns, path) == [100, 200, 300, 470, 570]


def test_a_stop_over_the_detour_limit_is_used_only_when_nothing_else_fits():
    ns = nodes(100, end=200)
    ns[1].over_limit = True
    assert cheapest_path(ns, RULES) is None
    path, level = plan_segment(ns, RULES)
    assert level == 1 and stops(ns, path) == [100]
    ns.insert(1, Node(95, 95))  # an ordinary stop nearby: used instead
    path, level = plan_segment(ns, RULES)
    assert level == 0 and stops(ns, path) == [95]


def test_an_unreachable_stop_is_never_used():
    ns = nodes(100, end=200)
    ns[1].usable = False
    path, level = plan_segment(ns, RULES)
    assert stops(ns, path) == [] and level == 2


def test_a_pinned_stop_is_on_the_path_and_the_rest_is_planned_around_it():
    ns = nodes(*range(10, 400, 10), end=400)
    pinned = next(n for n in ns if n.minute == 40)
    pinned.pinned = True
    path, _ = plan_segment(ns, RULES)
    times = stops(ns, path)
    assert times[0] == 40
    assert all(90 <= b - a <= 120 for a, b in zip(times, times[1:]))


def test_a_pin_too_far_out_is_kept_and_the_gap_relaxed():
    ns = nodes(100, 200, end=300)
    ns[2].pinned = True  # minute 200, with nothing allowed... except 100
    path, level = plan_segment(ns, RULES)
    assert 200 in stops(ns, path) and level == 0
    ns = nodes(200, end=300)
    ns[1].pinned = True  # 200 min from the start with nothing before it
    path, level = plan_segment(ns, RULES)
    assert stops(ns, path) == [200] and level == 2


def test_a_pinned_stop_over_the_detour_limit_needs_no_relaxing():
    ns = nodes(100, end=200, over_limit=True, pinned=True)
    path, level = plan_segment(ns, RULES)
    assert stops(ns, path) == [100] and level == 0


def test_kind_cost_wins_a_close_call_but_not_a_big_timing_gap():
    rest_area, town = Node(95, 95, cost=0), Node(110, 110, cost=8)
    assert stops(*_pair(rest_area, town)) == [95]  # both in the window: the rest area
    rest_area = Node(70, 70, cost=0)  # 20 min before the window opens: the town on time
    assert stops(*_pair(rest_area, town)) == [110]


def _pair(a, b):
    ns = [Node(0, 0), a, b, Node(200, 200)]
    return ns, cheapest_path(ns, RULES)


def test_miles_count_too_whichever_comes_first():
    # A fast road: 100 minutes but 170 miles is past the 165-mile hard maximum.
    fast = [Node(0, 0), Node(95, 80), Node(170, 100), Node(230, 200)]
    assert share(fast[0], fast[2], RULES) == 170 / 150
    path = cheapest_path(fast, RULES)
    assert [fast[i].mile for i in path[1:-1]] == [95]


def test_window_cost_is_zero_inside_and_grows_outside():
    assert gap_cost(0.8, RULES, to_end=False) == 0
    assert gap_cost(0.5, RULES, to_end=False) == 30  # 0.25 x 120 min early
    assert gap_cost(0.5, RULES, to_end=True) == 0  # arriving soon after a break is fine
    assert round(gap_cost(1.05, RULES, to_end=False), 6) == 12  # 6 min late, twice the weight
    assert gap_cost(1.2, RULES, to_end=False) is None
    assert gap_cost(1.2, RULES.relaxed(2), to_end=False) > gap_cost(1.1, RULES, to_end=False)
