#!/usr/bin/env python3
"""Normalize Tarrant County Clarity precinct returns for the offline dashboard.

Supports Clarity's structured detailxml.zip, and tabular SpreadsheetML/XLSX data
where the sheet explicitly supplies precinct, contest, candidate and vote counts.
Unknown workbook layouts fail with an inspectable diagnostic rather than fabricated data.
Only Python standard library is required.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import io
import json
from pathlib import Path
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

HERE = Path(__file__).resolve().parent.parent
DEFAULT_XML = 'https://results.enr.clarityelections.com/TX/Tarrant/127297/385548/reports/detailxml.zip'
DEFAULT_XLSX = 'https://results.enr.clarityelections.com/TX/Tarrant/127297/385548/reports/detailxlsx.zip'


def localname(tag):
    return tag.rsplit('}', 1)[-1] if isinstance(tag, str) else ''


def norm(s):
    s = str(s or '').casefold().replace('&', ' and ')
    s = re.sub(r'\b(u\.?s\.?|united states)\b', 'us', s)
    for pattern, value in ((r'\bdist(?:rict)?\b', 'district'), (r'\brep(?:resentative)?\b', 'representative'),
                           (r'\bsen(?:ator)?\b', 'senator'), (r'\bco(?:unty)?\b', 'county'),
                           (r'\bcomm(?:issioner)?\b', 'commissioner'), (r'\btx\b', 'texas')):
        s = re.sub(pattern, value, s)
    s = re.sub(r'[^a-z0-9]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def precinct_id(raw):
    s = str(raw or '').strip()
    s = re.sub(r'\.0$', '', s)
    if re.fullmatch(r'\d{3,5}', s):
        return s.zfill(4)
    m = re.fullmatch(r'(?:voting\s+)?(?:precinct|pct|prec|p)\s*#?\s*(\d{3,5})', s, flags=re.I)
    if m:
        return m.group(1).zfill(4)
    return None


def number(s):
    if s is None or str(s).strip() == '':
        return None
    s = str(s).replace(',', '').strip()
    if not re.fullmatch(r'\d+(?:\.0+)?', s):
        return None
    return int(float(s))


def method_name(name):
    v = norm(name)
    if not v:
        return None
    if v in {'total', 'total votes', 'all votes', 'totals'}:
        return 'total'
    if any(x in v for x in ['absentee', 'mail']):
        return 'mail'
    if 'early' in v or 'advance' in v:
        return 'early'
    if 'election day' in v or v in {'day', 'polling place'}:
        return 'day'
    # Provisional and write-in methods still count towards the overall total.
    return 'other:' + v


def read_contests(html_path):
    text = html_path.read_text(encoding='utf-8')
    m = re.search(r'<script\s+id="election-data"\s+type="application/json">(.*?)</script>', text, re.S)
    if not m:
        raise ValueError('Cannot locate embedded election-data JSON in index.html')
    contests = json.loads(m.group(1))
    names = defaultdict(list)
    for c in contests:
        names[norm(c['name'])].append(c)
    return contests, names


def geo_ids(path):
    if not path.exists():
        return set()
    o = json.loads(path.read_text())
    if o.get('type') != 'Topology':
        return set()
    result = set()
    for obj in o['objects'].values():
        for f in obj.get('geometries', []):
            p = f.get('properties') or {}
            v = p.get('precinct') or p.get('PREC') or f.get('id')
            n = precinct_id(v)
            if n:
                result.add(n)
    return result


def pick_contest(raw, names):
    v = norm(raw)
    candidates = names.get(v, [])
    if len(candidates) == 1:
        return candidates[0]
    # A contained common label is useful for vendor prefixes like "County - Governor".
    if not candidates:
        matches = [c for k, cs in names.items() if v.endswith(' ' + k) or v.startswith(k + ' ')
                   for c in cs]
        if len(matches) == 1:
            return matches[0]
    return None


def pick_candidate(raw, contest):
    name = norm(re.sub(r'\s*\((?:dem|rep|lib|grn|d|r|l|g)\)\s*$', '', str(raw), flags=re.I))
    matches = [i for i, c in enumerate(contest['candidates']) if norm(c['name']) == name]
    return matches[0] if len(matches) == 1 else None


class Accumulator:
    def __init__(self, names, geo):
        self.names, self.geo = names, geo
        self.raw = defaultdict(dict)
        self.stats = Counter()
        self.unknown = Counter()
        self.examples = defaultdict(set)
        self.seen = set()
        self.precincts = set()

    def add(self, precinct, contest_name, candidate_name, method, votes):
        self.stats['source_cells'] += 1
        p = precinct_id(precinct)
        if not p:
            self.unknown['unrecognized precinct'] += 1
            if len(self.examples['precinct']) < 12:
                self.examples['precinct'].add(str(precinct))
            return
        if self.geo and p not in self.geo:
            self.unknown['precinct not in geometry'] += 1
            if len(self.examples['missingGeometry']) < 12:
                self.examples['missingGeometry'].add(p)
            return
        c = pick_contest(contest_name, self.names)
        if c is None:
            self.unknown['contest not on dashboard'] += 1
            if len(self.examples['contest']) < 24:
                self.examples['contest'].add(str(contest_name))
            return
        i = pick_candidate(candidate_name, c)
        if i is None:
            self.unknown['candidate not matched'] += 1
            if len(self.examples['candidate']) < 24:
                self.examples['candidate'].add(c['name'] + ' / ' + str(candidate_name))
            return
        v = number(votes)
        if v is None:
            self.unknown['invalid vote count'] += 1
            return
        m = method_name(method)
        if m is None:
            self.unknown['unspecified vote method'] += 1
            return
        key = (p, c['id'], i)
        fingerprint = (*key, m)
        if fingerprint in self.seen:
            self.unknown['duplicate precinct/contest/candidate/method'] += 1
            raise ValueError(f'Duplicate vote cell {fingerprint}: do not silently double-count')
        self.seen.add(fingerprint)
        self.raw[key][m] = v
        self.precincts.add(p)
        self.stats['accepted_cells'] += 1

    def output(self):
        rows=[]
        for (p,r,c), methods in sorted(self.raw.items()):
            total = methods.get('total')
            component_total = sum(v for m,v in methods.items() if m != 'total')
            if total is None:
                total = component_total
            elif component_total and total < component_total:
                raise ValueError(f'Vote methods exceed total for {p}/{r}/{c}: {methods}')
            rows.append([p,r,c,total,methods.get('mail'),methods.get('early'),methods.get('day')])
        return rows


def parse_clarity_xml(stream, acc):
    """Stream Clarity ElectionResult/Contest/Choice/VoteType/Precinct structure."""
    ctx=ET.iterparse(stream, events=('start','end'))
    _,root=next(ctx)
    if localname(root.tag) != 'ElectionResult':
        raise ValueError('Expected <ElectionResult> for Clarity detailed XML')
    contests = 0
    for event, el in ctx:
        if event != 'end' or localname(el.tag) != 'Contest':
            continue
        name=el.get('text') or el.get('name') or ''
        for choice in el:
            if localname(choice.tag) != 'Choice':
                continue
            cn=choice.get('text') or choice.get('name') or ''
            for vt in choice:
                if localname(vt.tag) != 'VoteType':
                    continue
                method=vt.get('name') or ''
                for p in vt:
                    if localname(p.tag) == 'Precinct':
                        acc.add(p.get('name'),name,cn,method,p.get('votes'))
        contests+=1
        root.clear()
        el.clear()
    if not contests:
        raise ValueError('Clarity XML has no <Contest> elements')
    acc.stats['source_contests']=contests


def column_label_idx(s):
    n=0
    for ch in re.match(r'[A-Z]+', s).group():
        n=n*26+ord(ch)-64
    return n-1


def xlsx_rows(z, sheet, shared):
    """Read shared/inline strings and sparse worksheet rows without loading sheet into RAM."""
    ns='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    with z.open(sheet) as inp:
        it=ET.iterparse(inp, events=('start','end'))
        _,root=next(it)
        seen=0
        for event, node in it:
            if event != 'end' or node.tag != ns+'row':
                continue
            cells={}
            for c in node.findall(ns+'c'):
                ref=c.get('r')
                if not ref or not re.match(r'[A-Z]+', ref):
                    continue
                idx=column_label_idx(ref)
                v=c.find(ns+'v')
                if c.get('t')=='inlineStr':
                    value=''.join((t.text or '') for t in c.findall('.//'+ns+'t'))
                elif v is None:
                    value=''
                elif c.get('t')=='s':
                    try:value=shared[int(v.text)]
                    except (IndexError,ValueError,TypeError):value=''
                else:
                    value=v.text or ''
                cells[idx]=value
            if cells:
                yield [cells.get(i, '') for i in range(max(cells)+1)]
            node.clear()
            seen+=1
            if seen%1000==0:
                root.clear()


def shared_strings(z):
    path='xl/sharedStrings.xml'
    if path not in z.namelist():return []
    ns='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    out=[]
    with z.open(path) as inp:
        for _,node in ET.iterparse(inp,events=('end',)):
            if node.tag==ns+'si':
                out.append(''.join((e.text or '') for e in node.iter(ns+'t')))
                node.clear()
    return out


def spreadsheetml_rows(stream):
    """Excel 2003 XML Spreadsheet 2003 row iterator."""
    uri='{urn:schemas-microsoft-com:office:spreadsheet}'
    it=ET.iterparse(stream, events=('start','end'))
    _,root=next(it)
    seen=0
    for event,node in it:
        if event!='end' or node.tag!=uri+'Row':continue
        row=[]
        for c in node.findall(uri+'Cell'):
            idx=c.get(uri+'Index')
            if idx:
                pos=int(idx)-1
                if pos>5000:raise ValueError('Suspiciously wide XML spreadsheet row')
                while len(row)<pos:row.append('')
            data=c.find(uri+'Data')
            row.append(data.text if data is not None and data.text else '')
        yield row
        node.clear()
        seen+=1
        if seen%1000==0:
            root.clear()


def identify_columns(cols):
    n=[norm(c).replace(' ', '') for c in cols]
    def find(exacts):
        return next((i for i,k in enumerate(n) if k in exacts),None)
    result={
        'precinct':find({'precinct','precinctnumber','votingprecinct','precinctid','pct','prec'}),
        'contest':find({'contest','contestname','race','racename','office','officename'}),
        'candidate':find({'candidate','candidatename','choice','choicename','selection','name'}),
        'method':find({'method','votetype','votingmethod'}),
        'votes':find({'votes','votecount','count','vote'}),
        'total':find({'total','totalvotes','votescast'}),
        'mail':find({'mail','absentee','bymail','mailvotes'}),
        'early':find({'early','earlyvoting','earlyinperson'}),
        'day':find({'day','electionday','electiondayvotes'}),
    }
    if all(result[k] is not None for k in ('precinct','contest','candidate')) and (result['votes'] is not None or any(result[k] is not None for k in ('total','mail','early','day'))):
        return result
    return None


def parse_table(rows, acc, source_name, inspect=False):
    first=[];columns=None;count=0
    for row in rows:
        if len(first)<15:
            first.append(row[:18])
        if not columns:
            columns=identify_columns(row)
            if columns:
                acc.stats['recognized_sheets']+=1
            continue
        if identify_columns(row):
            continue
        def val(k):
            i=columns.get(k)
            return row[i] if i is not None and i<len(row) else ''
        p,contest,cand=val('precinct'),val('contest'),val('candidate')
        if not p or not contest or not cand:
            continue
        if columns['votes'] is not None:
            acc.add(p,contest,cand,val('method') or 'total',val('votes'))
            count+=1
        else:
            for key in ('total','mail','early','day'):
                if columns[key] is not None and val(key)!='':
                    acc.add(p,contest,cand,key,val(key))
                    count+=1
    if not columns:
        acc.examples['unrecognizedSpreadsheet'].add(source_name+' first rows: '+json.dumps(first,ensure_ascii=False)[:1600])
    return count


def parse_source(path, acc):
    """Discover archive layout and parse XML or tabular workbooks."""
    archive_files=[]
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            entries=[n for n in z.namelist() if not n.endswith('/')]
            archive_files=entries
            for n in entries:
                if n.lower().endswith('detail.xml') or n.lower().endswith('detailxml.xml'):
                    with z.open(n) as inp:
                        signature=inp.read(4000)
                    if b'ElectionResult' in signature:
                        with z.open(n) as inp:
                            parse_clarity_xml(inp,acc)
                        return {'kind':'Clarity detailed XML','entry':n,'entries':entries}
                    if b'Workbook' in signature or b'Spreadsheet' in signature:
                        with z.open(n) as inp:
                            parse_table(spreadsheetml_rows(inp),acc,n)
                        return {'kind':'XML Spreadsheet','entry':n,'entries':entries}
            # Some ZIP exports have a differently named XML with the ElectionResult root.
            for n in entries:
                if n.lower().endswith('.xml') and not n.startswith('xl/'):
                    with z.open(n) as inp:
                        magic=inp.read(1500)
                    if b'ElectionResult' in magic:
                        with z.open(n) as inp:
                            parse_clarity_xml(inp,acc)
                        return {'kind':'Clarity detailed XML','entry':n,'entries':entries}
            workbook_names=[n for n in entries if n.lower().endswith('.xlsx')]
            if '[Content_Types].xml' in entries: # input IS an XLSX archive
                workbook_names=['<direct xlsx>']
            if workbook_names:
                for n in workbook_names:
                    content=path if n=='<direct xlsx>' else io.BytesIO(z.read(n))
                    with zipfile.ZipFile(content) as inner:
                        strings=shared_strings(inner)
                        sheets=[x for x in inner.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml',x)]
                        for sheet in sheets:
                            parse_table(xlsx_rows(inner,sheet,strings),acc,n+'!'+sheet)
                return {'kind':'XLSX spreadsheet','entry':workbook_names,'entries':entries}
            for n in entries:
                if n.lower().endswith('.xml'):
                    with z.open(n) as inp:
                        magic=inp.read(1500)
                    if b'Spreadsheet' in magic or b'Workbook' in magic:
                        with z.open(n) as inp:
                            parse_table(spreadsheetml_rows(inp),acc,n)
                        return {'kind':'XML Spreadsheet','entry':n,'entries':entries}
        raise ValueError('Archive has no recognizable Clarity XML or spreadsheet: '+', '.join(entries[:25]))
    if path.suffix.lower() == '.xml':
        head=path.read_bytes()[:1000]
        with path.open('rb') as inp:
            if b'ElectionResult' in head:
                parse_clarity_xml(inp,acc)
                kind='Clarity detailed XML'
            else:
                parse_table(spreadsheetml_rows(inp),acc,path.name)
                kind='XML Spreadsheet'
        return {'kind':kind,'entry':path.name,'entries':[path.name]}
    raise ValueError(f'Unsupported input {path}; supply .zip, .xlsx or .xml')


def download(url,path):
    path.parent.mkdir(parents=True,exist_ok=True)
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 (compatible; TarrantElectionData/1.0)'})
    with urllib.request.urlopen(req,timeout=50) as r, path.open('wb') as dst:
        while True:
            block=r.read(1024*1024)
            if not block:break
            dst.write(block)
    if not zipfile.is_zipfile(path):
        path.unlink(missing_ok=True)
        raise ValueError('Download was not a ZIP archive')
    return path


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source',help='Local .zip/.xml/.xlsx; default tries structured XML then XLSX from the given election URL')
    ap.add_argument('--html',type=Path,default=HERE/'index.html')
    ap.add_argument('--geometry',type=Path,default=HERE/'data/tarrant_precincts_2026.topojson')
    ap.add_argument('--output',type=Path,default=HERE/'data/precinct_results_2026.json.gz')
    ap.add_argument('--manifest',type=Path,default=HERE/'data/precinct_results_manifest.json')
    ap.add_argument('--inspect',action='store_true',help='Show archive layout and sample diagnostics')
    args=ap.parse_args()
    contests,names=read_contests(args.html)
    geo=geo_ids(args.geometry)
    print(f'Dashboard: {len(contests)} races | mapped precincts: {len(geo)}')
    if args.source:
        if args.source.startswith(('http://','https://')):
            path=HERE/'data/source'/Path(args.source.split('?')[0]).name
            if not path.exists():
                print('Downloading:',args.source)
                download(args.source,path)
        else:path=Path(args.source)
    else:
        for url in (DEFAULT_XML,DEFAULT_XLSX):
            path=HERE/'data/source'/url.split('/')[-1]
            if path.exists():
                print('Using local archive:',path)
                break
            try:
                print('Downloading:',url)
                download(url,path)
                break
            except Exception as e:
                print('Download failed:',e,file=sys.stderr)
        else:
            ap.error('Could not download either report. Download the archive in your browser and pass --source PATH')
    if not path.exists():ap.error(f'Not found: {path}')
    print('Reading:',path,'size:',path.stat().st_size)
    acc=Accumulator(names,geo)
    info=parse_source(path,acc)
    rows=acc.output()
    per_race=Counter(r[1] for r in rows)
    unmatched=dict(acc.unknown)
    per_candidate = defaultdict(int)
    for p,r,c,total,mail,early,day in rows:
        per_candidate[(r,c)]+=total
    old_by_key = {(race['id'],i):(race['name'],cand['name'],cand['total'])
                  for race in contests for i,cand in enumerate(race['candidates'])}
    reconciliation = [dict(race=rname,candidate=cname,original_countywide=original,
                           new_precinct_sum=value,difference=value-original)
                      for key,value in per_candidate.items()
                      if key in old_by_key
                      for rname,cname,original in [old_by_key[key]]
                      if original!=value]
    manifest={'source':str(path),'source_format':info['kind'],'archive_entry':info['entry'],
              'archive_files':info['entries'][:30], 'geometry_precincts':len(geo),
              'result_precincts':len(acc.precincts),'result_races':len(per_race),
              'result_rows':len(rows),'matched_source_cells':acc.stats['accepted_cells'],
              'total_source_cells':acc.stats['source_cells'],'unmatched':unmatched,
              'diagnostics':{k:sorted(v) for k,v in acc.examples.items()},
              'countywide_snapshot_differences':{'count':len(reconciliation),'examples':reconciliation[:30],
                  'note':'Expected if new precinct report is later than the HTML snapshot or not all geographic precincts were matched.'},
              'data_schema':'rows [precinct,contest_id,candidate_index,total,mail,early,day]',
              'source_report_status':'unverified - compare with snapshot cumulative report before interpretation'}
    args.manifest.parent.mkdir(parents=True,exist_ok=True)
    args.manifest.write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({k:v for k,v in manifest.items() if k not in ('archive_files','diagnostics')},indent=2))
    if args.inspect:
        print('Diagnostics:',json.dumps(manifest['diagnostics'],indent=2,ensure_ascii=False))
    if not rows:
        raise SystemExit('No matching precinct vote rows. Check manifest diagnostics; do not publish empty or guessed margins. Try --source detailxml.zip if your XLSX is a formatted report.')
    payload={'schema':1,'source':str(path.name),'rows':rows}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('wb') as sink:
        sink.write(gzip.compress(json.dumps(payload,separators=(',',':'),ensure_ascii=False).encode(),compresslevel=9,mtime=0))
    print('Wrote:',args.output, f'({args.output.stat().st_size:,} compressed bytes)')
    if unmatched:
        print('WARNING: Some source cells were not mapped; see '+str(args.manifest),file=sys.stderr)
    return 0

if __name__=='__main__':
    raise SystemExit(main())
