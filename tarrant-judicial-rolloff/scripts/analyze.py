"""Normalize official exports and measure judicial participation without double counting."""
from pathlib import Path
from collections import defaultdict
import gzip
import io
import json
import re
import zipfile
import xml.etree.ElementTree as ET
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
RAW = DATA / 'raw'
OUT = ROOT / 'outputs'

def kind(title):
    if title == 'County Judge':
        return 'county_executive'
    if title.startswith('Justice of the Peace'):
        return 'justice_of_peace'
    if re.match(r'(Criminal |Family )?District Judge|Judge, County', title):
        return 'local_trial'
    if re.match(r'(Chief )?Justice,|((Presiding )?Judge, Court of Criminal Appeals)', title):
        return 'appellate'
    return 'other'

def benchmark(title):
    if title.startswith('President'):
        return 'President'
    return {'United States Senator':'U.S. Senate', 'Governor':'Governor'}.get(title)

def read_tally(year):
    text = gzip.decompress((RAW / f'{year}-tally.txt.gz').read_bytes()).decode('utf-8-sig', errors='replace')
    skip = int(text.startswith(('#FormatVersion', 'Format#')))
    df = pd.read_csv(io.StringIO(text), skiprows=skip, dtype=str).fillna('')
    old = 'Contest_title' in df
    mapping = ({'Pct_Id':'unit', 'Precinct_name':'precinct', 'Contest_Id':'contest_id',
                'Contest_title':'contest', 'candidate_name':'candidate', 'Party_Code':'party',
                'total_votes':'votes', 'total_ballots':'ballots',
                'total_under_votes':'under', 'total_over_votes':'over'} if old else
               {'Precinct ID':'unit', '#Precinct':'precinct', 'Contest ID':'contest_id',
                'Contest Title':'contest', 'Choice Name':'candidate', 'Choice Party':'party',
                'Total Votes':'votes', 'Ballots Cast':'ballots',
                'Total Undervotes':'under', 'Total Overvotes':'over', 'Total Invalid Votes':'invalid'})
    df = df.rename(columns=mapping)
    if old:
        df['invalid'] = 0
    df['precinct'] = df.precinct.str.extract(r'^(\d{4})', expand=False).fillna(df.precinct)
    df['year'] = year
    for field in ('votes','ballots','under','over','invalid'):
        df[field] = pd.to_numeric(df[field], errors='raise').astype('int64')
    return df[['year','unit','precinct','contest_id','contest','candidate','party','votes','ballots','under','over','invalid']]

def read_current():
    with zipfile.ZipFile(RAW / '2026-detailxml.zip') as z:
        root = ET.fromstring(z.read('detail.xml'))
    turnout = {p.get('name'): int(p.get('ballotsCast')) for p in root.findall('VoterTurnout/Precincts/Precinct')}
    rows = []
    for c in root.findall('Contest'):
        if kind(c.get('text')) == 'other' and not benchmark(c.get('text')):
            continue
        undervotes = {p.get('name'): int(p.get('votes')) for p in c.find("VoteType[@name='Undervotes']")}
        overvotes = {p.get('name'): int(p.get('votes')) for p in c.find("VoteType[@name='Overvotes']")}
        for ch in c.findall('Choice'):
            byunit = defaultdict(int)
            for vt in ch.findall('VoteType'):
                assert sum(int(p.get('votes')) for p in vt) == int(vt.get('votes'))
                for p in vt:
                    byunit[p.get('name')] += int(p.get('votes'))
            assert sum(byunit.values()) == int(ch.get('totalVotes'))
            for unit, votes in byunit.items():
                assert unit in turnout, unit
                rows.append(dict(year=2026, unit=unit, precinct=re.match(r'^\d{4}', unit)[0],
                                 contest_id=c.get('key'), contest=c.get('text'), candidate=ch.get('text'),
                                 party=ch.get('party',''), votes=votes, ballots=turnout[unit],
                                 under=undervotes[unit], over=overvotes[unit], invalid=0))
    return pd.DataFrame(rows), root.findtext('Timestamp')

def prepare(df):
    df = df.copy()
    df['category'] = df.contest.map(kind)
    df['benchmark'] = df.contest.map(benchmark)
    return df[(df.category != 'other') | df.benchmark.notna()].copy()

def one_election(df):
    year = int(df.year.iloc[0])
    keys = ['contest_id','unit']
    # Ballots and undervotes repeat on every candidate row. Count them only ONCE per unit/contest.
    for col in ('ballots','under','over','invalid'):
        assert df.groupby(keys)[col].nunique().max() == 1, (year,col)
    unit = df.groupby(keys).agg(precinct=('precinct','first'), contest=('contest','first'),
        votes=('votes','sum'),ballots=('ballots','first'),under=('under','first'),over=('over','first'),
        invalid=('invalid','first')).reset_index()
    # Rejected/unassigned write-in buckets are ballot-accounting rows, not extra candidates.
    real = df[~df.candidate.str.contains(r'^(?:Rejected|Unassigned|Unresolved) write',case=False,regex=True)]
    unit=unit.merge(real.groupby(keys).votes.sum().rename('named_votes').reset_index(),on=keys,how='left')
    unit['named_votes']=unit.named_votes.fillna(0).astype('int64')
    allrows = []
    candidates = []
    for cid, g in df.groupby('contest_id', sort=False):
        u = unit[unit.contest_id == cid]
        names = real[real.contest_id == cid][['candidate','party']].drop_duplicates()
        title = g.contest.iloc[0]
        cat = kind(title)
        voted = int(g.votes.sum())
        ballots = int(u.ballots.sum())
        named = real[real.contest_id == cid]
        named_votes = int(named.votes.sum())
        residual = ballots - voted - int(u.under.sum()) - int(u.over.sum()) - int(u.invalid.sum())
        rec = dict(year=year,contest_id=cid,contest=title,category=cat,benchmark=benchmark(title),
                   candidate_count=len(names),status='Uncontested' if len(names)==1 else 'Contested',
                   both_major_parties={'REP','DEM'}.issubset(set(names.party)),
                   uncontested_party=names.party.iloc[0] if len(names)==1 else '',
                   candidates='; '.join(f'{r.candidate} ({r.party or "write-in"})' for r in names.itertuples()),
                   ballots=ballots,votes=voted,named_candidate_votes=named_votes,
                   rejected_unassigned_votes=voted-named_votes,undervotes=int(u.under.sum()),
                   overvotes=int(u.over.sum()),invalid_votes=int(u.invalid.sum()),
                   accounting_residual=residual,skip_rate=int(u.under.sum())/ballots if ballots else None,
                   vote_rate=named_votes/ballots if ballots else None)
        allrows.append(rec)
        for (name,party), cg in g.groupby(['candidate','party'],dropna=False):
            candidates.append(dict(year=year,contest_id=cid,contest=title,candidate=name,party=party,votes=int(cg.votes.sum())))
    contests = pd.DataFrame(allrows)
    comps = []
    precincts = []
    relations = []
    bm = contests[contests.benchmark.notna()].copy()
    order = {'President':0,'U.S. Senate':1,'Governor':2}
    main_cid = min(bm.itertuples(), key=lambda r:order[r.benchmark]).contest_id
    for b in bm.itertuples():
        bu = unit[unit.contest_id == b.contest_id].set_index('unit')
        bdf = df[df.contest_id == b.contest_id]
        bp = bdf.pivot_table(index='unit',columns='party',values='votes',aggfunc='sum',fill_value=0)
        for c in contests[contests.category != 'other'].itertuples():
            cu = unit[unit.contest_id == c.contest_id].set_index('unit')
            match = cu.join(bu[['named_votes','ballots','under']].rename(columns={'named_votes':'votes'}),how='inner',rsuffix='_benchmark')
            match = match.join(bp.reindex(columns=['REP','DEM'],fill_value=0))
            assert len(match) == len(cu), (year,c.contest,b.contest,'unmatched units')
            # Eligibility differs for federal-only limited ballots. Match units before any comparison.
            assert (match.ballots == match.ballots_benchmark).all(), (year,c.contest,'ballot mismatch')
            valid_base = int(match.votes_benchmark.sum())
            party_votes = int(match[c.uncontested_party].sum()) if c.uncontested_party in ('REP','DEM') else None
            comps.append(dict(year=year,contest_id=c.contest_id,contest=c.contest,category=c.category,
                status=c.status,uncontested_party=c.uncontested_party,benchmark=b.benchmark,
                both_major_parties=c.both_major_parties,
                primary_benchmark=b.contest_id==main_cid,ballots=c.ballots,judicial_votes=c.named_candidate_votes,
                judicial_undervotes=c.undervotes,judicial_skip_rate=c.skip_rate,
                benchmark_votes_matched=valid_base,benchmark_undervotes_matched=int(match.under_benchmark.sum()),
                retention_vs_benchmark=c.named_candidate_votes/valid_base if valid_base else None,
                rolloff_vs_benchmark=1-c.named_candidate_votes/valid_base if valid_base else None,
                same_party_benchmark_votes=party_votes,
                excess_over_same_party_benchmark=c.named_candidate_votes-party_votes if party_votes is not None else None,
                same_party_retention=c.named_candidate_votes/party_votes if party_votes else None,
                accounting_residual=c.accounting_residual))
            if c.status != 'Uncontested' or c.uncontested_party not in ('REP','DEM'):
                continue
            opposite = 'DEM' if c.uncontested_party=='REP' else 'REP'
            agg = match.groupby('precinct')[['ballots','votes','under','REP','DEM']].sum()
            agg['opposite_party_share'] = agg[opposite]/(agg.REP+agg.DEM)
            agg['skip_rate'] = agg.under/agg.ballots
            good = agg[(agg.ballots>=100)&((agg.REP+agg.DEM)>=50)].copy()
            for p in good.itertuples():
                precincts.append(dict(year=year,contest_id=c.contest_id,contest=c.contest,party=c.uncontested_party,
                    category=c.category,benchmark=b.benchmark,primary_benchmark=b.contest_id==main_cid,
                    precinct=p.Index,ballots=p.ballots,undervotes=p.under,skip_rate=p.skip_rate,
                    opposite_party_share=p.opposite_party_share))
            if len(good)>2:
                x=good.opposite_party_share.to_numpy(); y=good.skip_rate.to_numpy(); w=good.ballots.to_numpy()
                mx=np.average(x,weights=w); my=np.average(y,weights=w)
                cov=np.average((x-mx)*(y-my),weights=w)
                vx=np.average((x-mx)**2,weights=w); vy=np.average((y-my)**2,weights=w)
                relations.append(dict(year=year,contest_id=c.contest_id,contest=c.contest,category=c.category,
                    party=c.uncontested_party,benchmark=b.benchmark,primary_benchmark=b.contest_id==main_cid,
                    precinct_count=len(good),weighted_correlation=cov/np.sqrt(vx*vy) if vx*vy>0 else None,
                    slope=cov/vx if vx else None))
                relations[-1]['intercept'] = my-(cov/vx)*mx if vx else None
                relations[-1]['modeled_skip_at_50pct_opposition'] = my+(cov/vx)*(0.5-mx) if vx else None
    return contests,candidates,comps,precincts,relations

def main():
    OUT.mkdir(exist_ok=True)
    frames = [prepare(read_tally(y)) for y in range(2010,2025,2)]
    current,timestamp = read_current()
    frames.append(prepare(current))
    cs=[]; candidates=[]; comparisons=[]; precincts=[]; relations=[]
    for frame in frames:
        contests,cand,comp,prec,rel = one_election(frame)
        cs.append(contests);candidates.extend(cand);comparisons.extend(comp);precincts.extend(prec);relations.extend(rel)
    contests=pd.concat(cs,ignore_index=True)
    comparisons=pd.DataFrame(comparisons)
    relations=pd.DataFrame(relations)
    summaries=[]
    scopes={'Countywide judiciary':['local_trial','appellate'], 'Local trial courts':['local_trial'],
            'Appellate courts':['appellate'],'Justices of the peace':['justice_of_peace'],
            'County executive':['county_executive'], 'All judiciary including JP':['local_trial','appellate','justice_of_peace']}
    for (year,bm),g in comparisons.groupby(['year','benchmark']):
        for scope,cats in scopes.items():
            for status in ('All','Contested','Uncontested','R–D contested'):
                selected=g[g.category.isin(cats)]
                if status=='R–D contested':selected=selected[selected.both_major_parties]
                elif status!='All':selected=selected[selected.status==status]
                ballots=int(selected.ballots.sum()); votes=int(selected.judicial_votes.sum()); base=int(selected.benchmark_votes_matched.sum())
                summaries.append(dict(year=year,benchmark=bm,primary_benchmark=bool(g.primary_benchmark.iloc[0]),scope=scope,status=status,
                    race_count=len(selected),ballot_opportunities=ballots,judicial_votes=votes,
                    average_votes_per_race=votes/len(selected) if len(selected) else None,
                    undervotes=int(selected.judicial_undervotes.sum()),
                    skip_rate=selected.judicial_undervotes.sum()/ballots if ballots else None,
                    matched_benchmark_votes=base,retention_vs_benchmark=votes/base if base else None,
                    rolloff_vs_benchmark=1-votes/base if base else None))
    summary=pd.DataFrame(summaries)
    tables={'contests':contests,'candidates':pd.DataFrame(candidates),'comparisons':comparisons,
            'year_summary':summary,'precinct_uncontested':pd.DataFrame(precincts),'precinct_relationships':relations}
    for name,table in tables.items():table.to_csv(OUT/f'{name}.csv',index=False,float_format='%.8f')
    payload={k:json.loads(v.to_json(orient='records')) for k,v in tables.items() if k!='precinct_uncontested'}
    payload['snapshot']=timestamp
    current_precincts=tables['precinct_uncontested'].query('year==2026 and category=="local_trial"')
    scatter=current_precincts.groupby(['benchmark','precinct']).agg(
        ballots=('ballots','mean'),skip_rate=('skip_rate','mean'),
        opposite_party_share=('opposite_party_share','mean'),race_count=('contest_id','size')).reset_index()
    payload['precincts_2026']=json.loads(scatter.to_json(orient='records'))
    payload['declared_elected']=json.loads(pd.read_csv(DATA/'declared_elected_2022.csv').to_json(orient='records'))
    payload['sources']=json.loads((DATA/'sources.json').read_text())
    (OUT/'report-data.json').write_text(json.dumps(payload,separators=(',',':'))+'\n')
    print(summary[(summary.scope=='Countywide judiciary')&summary.primary_benchmark][['year','benchmark','status','race_count','skip_rate','retention_vs_benchmark']].to_string(index=False))
    print('Accounting residuals:',contests.loc[contests.accounting_residual!=0,['year','contest','accounting_residual']].to_string(index=False))
    print('2026 uncontested:',comparisons.query('year==2026 and primary_benchmark and status=="Uncontested"')[['contest','uncontested_party','judicial_votes','judicial_skip_rate','same_party_retention']].to_string(index=False))

if __name__=='__main__':main()
