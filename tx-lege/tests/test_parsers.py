from txlege import journal as J
from txlege.build import amendment_number, classify, result_of
from txlege.people import Person, Resolver
from txlege.tlo import html_to_text, parse_bill_arg


def para(text, align="justify"):
    return f'<div class="textpara" style="text-indent:2em;text-align:{align}">{text}</div>'


def test_parse_bill_arg():
    b = parse_bill_arg("https://legiscan.com/TX/drafts/SB17/2025")
    assert (b.session, b.prefix, b.number) == ("89R", "SB", 17)
    assert parse_bill_arg("HB 2", "89R").tlo == "HB2"
    assert parse_bill_arg("https://capitol.texas.gov/BillLookup/History.aspx?LegSess=892&Bill=HJR4").session == "892"
    assert parse_bill_arg("sjr 0012", "88(3)").session == "883"


def test_journal_html_url():
    url = "http://journals.house.texas.gov/hjrnl/89r/pdf/89RDAY59FINAL.PDF#page=21&seqNum=593"
    assert J.html_url_for(url) == "https://journals.house.texas.gov/hjrnl/89r/html/89RDAY59FINAL.HTM"
    url = "http://journals.senate.texas.gov/sjrnl/89r/pdf/89RSJ03-19-F1.PDF#page=26"
    assert J.html_url_for(url) == "https://journals.senate.texas.gov/sjrnl/89r/html/89RSJ03-19-F1.HTM"


HOUSE = "".join([
    para("<b>CSSB&nbsp;17 ON SECOND READING</b>", "center"),
    para("Representative Hefner moved to table Amendment No. 2."),
    para("The motion to table prevailed by (Record 1846):  84 Yeas, 59 Nays, 2 Present, not voting."),
    para("Yeas &#x2014; Bell, C.; Bell, K.; Leo Wilson; Wilson."),
    para("Nays &#x2014; Harris Davila; Anch&#xED;a."),
    para("Present, not voting &#x2014; Mr. Speaker; Geren(C)."),
    para("Absent, Excused, Committee Meeting &#x2014; Hunter."),
    para("<b>STATEMENTS OF VOTE</b>", "center"),
    para("When Record No. 1846 was taken, I was shown voting yes. I intended to vote no."),
    para("C. Bell", "right"),
    para("<b>MIDNIGHT</b>", "center"),
    para("Amendment No. 3 was adopted by (Record 1847):  1 Yea, 0 Nays, 0 Present, not voting."),
    para("Yeas &#x2014; Harris."),
    para("<b>HB 175 ON THIRD READING</b>", "center"),
    para("HB 175 was passed by (Record 1900):  1 Yea, 0 Nays, 0 Present, not voting."),
])


def test_house_votes_and_sections():
    paras = J.parse_paras(HOUSE)
    sections = J.bill_sections(paras, "SB", 17)
    assert len(sections) == 1 and sections[0].reading == "2"
    votes = J.parse_votes(paras, "H", "u")
    assert [v.record for v in votes] == [1846, 1847, 1900]
    v = votes[0]
    assert (v.yeas, v.nays, v.pnv) == (84, 59, 2)
    assert v.motion.startswith("Representative Hefner moved to table")
    assert v.members["Bell, C."] == "Y" and v.members["Anchía"] == "N"
    assert v.members["Geren"] == "PNV" and v.members["Hunter"] == "EXC"
    # MIDNIGHT doesn't end the bill's consideration; the next bill's header does.
    assert J.section_for(sections, votes[1].para) is sections[0]
    assert J.section_for(sections, votes[2].para) is None
    st = J.parse_statements(paras)[1846][0]
    assert (st.member, st.intended) == ("C. Bell", "N")


SENATE = "".join([
    para("The roll was called and the following Senators were present:  Alvarado, Bettencourt, A. Hinojosa, J. Hinojosa."),
    para("<b>COMMITTEE  SUBSTITUTE</b><b>SENATE BILL 17 ON SECOND READING</b>", "center"),
    para("Senator Kolkhorst moved to suspend the regular order of business to take up CSSB 17:"),
    para("The motion prevailed by the following vote:  Yeas 3, Nays 1."),
    para("Yeas:  Bettencourt, A. Hinojosa, J. Hinojosa."),
    para("Nays:  Alvarado."),
    para("The bill was read second time and was passed to engrossment by the following vote:  Yeas 3, Nays 1.  (Same as previous roll call)"),
    para("Floor Amendment No. 2"),
    para("The amendment to CSSB 17 was read and was adopted by a viva voce vote."),
    para('All Members are deemed to have voted "Yea" on the adoption of Floor Amendment No. 2 except as follows:'),
    para("Nays:  Alvarado."),
    para("CSSB 17 as amended was finally passed by the following vote:  Yeas 4, Nays 0."),
])


def test_senate_votes():
    paras = J.parse_paras(SENATE)
    assert J.bill_sections(paras, "SB", 17)[0].reading == "2"
    votes = J.parse_votes(paras, "S", "u")
    assert len(votes) == 4
    assert votes[1].same_as_previous and votes[1].members == votes[0].members
    deemed = votes[2]
    assert deemed.deemed and deemed.members["Alvarado"] == "N" and deemed.members["Bettencourt"] == "Y"
    assert (deemed.yeas, deemed.nays) == (3, 1)
    assert amendment_number(deemed.text, deemed.motion, []) == 2
    # No names printed for a unanimous vote: filled from the roll call.
    assert votes[3].inferred and set(votes[3].members.values()) == {"Y"} and len(votes[3].members) == 4


def test_classify():
    assert classify("The motion to table prevailed by (Record 1)", "") == "table"
    assert classify("Amendment No. 6, as amended, was adopted by (Record 2)", "") == "amendment"
    assert classify("CSSB 17, as amended, was passed to third reading by (Record 3)", "") == "passage"
    assert classify("The motion prevailed by the following vote", "Senator X moved to suspend the regular order") == "procedural"
    assert result_of("Amendment No. 2 failed of adoption (not receiving the necessary two-thirds vote)", 84, 61) == "failed"


def test_resolver_disambiguates_shared_surnames():
    people = [
        Person("Cecil Bell, Jr.", "R", "3", "H"),
        Person("Keith Bell", "R", "4", "H"),
        Person("Terri Leo Wilson", "R", "23", "H"),
        Person("Ellen Wilson", "R", "65", "H"),
        Person("Cody Harris", "R", "8", "H"),
        Person("Caroline Harris Davila", "R", "52", "H"),
        Person("Dustin Burrows", "R", "83", "H", speaker=True),
        Person("Juan 'Chuy' Hinojosa", "D", "20", "S"),
        Person("Adam Hinojosa", "R", "27", "S"),
    ]
    r = Resolver(people)
    got = r.assign("H", {"Bell, C.", "Bell, K.", "Leo Wilson", "Wilson", "Harris", "Harris Davila", "Mr. Speaker"})
    assert got["Bell, C."].name == "Cecil Bell, Jr." and got["Bell, K."].name == "Keith Bell"
    assert got["Leo Wilson"].name == "Terri Leo Wilson" and got["Wilson"].name == "Ellen Wilson"
    assert got["Harris"].name == "Cody Harris" and got["Harris Davila"].name == "Caroline Harris Davila"
    assert got["Mr. Speaker"].name == "Dustin Burrows"
    assert r.resolve("S", "J. Hinojosa").district == "20"
    assert r.resolve("S", 'Hinojosa, Juan "Chuy"').district == "20"
    assert r.resolve("H", "Bell, Cecil").district == "3"


def test_html_to_text_marks_changes():
    html = "<table><tr><td><meta name=PGLN>1-1</td><td>Sec. 1. The <s>old</s> <u>new</u> rule.</td></tr></table>"
    assert html_to_text(html).strip() == "Sec. 1. The [-old-] {+new+} rule."


def test_old_journal_markup():
    html = (
        "<P align=center><B>CSSB 14 ON SECOND READING</B></P>"
        "<P>Amendment No. 4 was adopted by (Record<FONT color=White>i</FONT>164): 2 Yeas, 1\n  Nays, 0 Present, not voting.</P>"
        "<P>Yeas &mdash; Brown, B.; Brown, F.</P><P>Nays &mdash; Allen.</P>"
    )
    paras = J.parse_paras(html)
    assert paras[0].centered and J.bill_sections(paras, "SB", 14)[0].reading == "2"
    v = J.parse_votes(paras, "H", "u")[0]
    assert v.record == 164 and v.members == {"Brown, B.": "Y", "Brown, F.": "Y", "Allen": "N"}


def test_senate_asked_to_be_recorded():
    paras = J.parse_paras("".join([
        para("The motion prevailed."),
        para('Senator Cook asked to be recorded as voting "Nay" on suspension of the regular order of business.'),
    ]))
    v = J.parse_votes(paras, "S", "u", ["Cook", "Hughes", "West"])[0]
    assert v.deemed and v.members == {"Cook": "N", "Hughes": "Y", "West": "Y"} and (v.yeas, v.nays) == (2, 1)


def test_senate_local_calendar():
    paras = J.parse_paras("".join([
        para("HB 128 (Kolkhorst)"),
        para("Relating to certain sister-city agreements."),
        para('(viva voce vote) (2-1) "Nays" Cook (2-1) "Nays" Cook'),
    ]))
    votes = J.parse_calendar_votes(paras, "HB", 128, "u", ["Cook", "Hughes", "West"])
    assert [v.reading for v in votes] == ["2", "3"]
    assert all(v.members["Cook"] == "N" and (v.yeas, v.nays) == (2, 1) for v in votes)


def test_paragraph_diff():
    from txlege.diff import diff_rows, word_diff

    old = ["SECTION 1. Intro.", "(1) a dog;", "(2) a cat;", "(3) a cow;", "(4) a pig;", "(5) a hen;", "SECTION 2. End."]
    new = ["SECTION 1. Intro.", "(1) a dog;", "(2) a cat;", "(3) a cow;", "(4) a pig;", "(5) a big hen;", "SECTION 3. New.", "SECTION 2. End."]
    rows, added, removed = diff_rows(old, new, context=1)
    kinds = [r[0] for r in rows]
    assert kinds == ["skip", "ctx", "del", "add", "add", "ctx"]
    assert rows[0][1] == 4 and (added, removed) == (2, 1)
    left, right = word_diff("(5) a hen;", "(5) a big hen;")
    assert "wdel" not in left and "<span class=wadd>big </span>" in right
