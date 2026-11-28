"""Extract comparable series, reconcile totals, and build the embedded dataset.

Run extract.py first. Dollar values are nominal, unrounded source dollars.
PDF page numbers are one-based file pages, not printed page labels.
"""
import csv, json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / 'source-manifest.json').read_text())
SOURCES = {s['id']: s for s in MANIFEST}
FED = ['breakfast', 'lunch', 'commodities', 'snacks', 'other_federal']
LABELS = {
 'breakfast':'School Breakfast Program', 'lunch':'National School Lunch Program',
 'commodities':'USDA commodities (noncash)', 'snacks':'Afterschool snacks',
 'other_federal':'Other federal program revenue', 'charges':'Charges for services',
 'state':'State matching and other', 'interest':'Investment earnings',
 'disposal':'Gain on disposal', 'capital':'Contributed capital', 'transfers':'Transfers in',
 'food_expense':'Food service expense', 'plant_expense':'Plant maintenance expense',
 'security_expense':'Security expense', 'expenses':'Total operating expenses',
 'nonoperating':'Total nonoperating revenue', 'net_change':'Change in net position',
}

def nums(t):
    return [int(v.replace(',','').replace('(','-').replace(')','')) if v != '-' else 0
            for v in re.findall(r'\(?-?\d[\d,]*\)?|(?<!\S)-(?!\S)', t)]

def source(sid, page, printed=None):
    return dict(id=sid, page=page, printed_page=printed,
                url=SOURCES[sid]['url'] + f'#page={page}')

def nutrition(year):
    sid=f'acfr-{year}'
    pages=(ROOT/'sources'/f'{sid}.txt').read_text().split('\f')
    i=151 if year==2017 else next(i for i,t in enumerate(pages) if i>100 and 'FOOD SERVICE FUND' in t.upper()
           and 'BUDGET' in t.upper() and '7952' in t)
    t=pages[i]
    if year==2017:
        t=(ROOT/'sources/acfr-2017-p152.txt').read_text().replace('g00,000','900,000')
    rowmap={}
    for line in t.splitlines():
        m=re.match(r'\s*(\d{4})\s+(.+)',line)
        if not m: continue
        code,tail=m.groups()
        key=None
        low=tail.lower()
        if code=='7952':key='breakfast'
        elif code=='7953':key='snacks' if 'snack' in low else 'lunch'
        elif code=='7954':key='commodities'
        elif code=='7989':key='other_federal' if 'federal' in low else 'state'
        elif code=='7955':key='interest'
        elif code=='7912':key='disposal'
        elif code=='7957':key='capital'
        elif code=='5020':key='charges'
        elif code=='0035':key='food_expense'
        elif code=='0051':key='plant_expense'
        elif code=='0052':key='security_expense'
        elif code=='6030':key='expenses'
        elif code in ['7020','7080']:key='nonoperating'
        elif code=='7915':key='transfers'
        elif code=='1300' or code=='1200':key='net_change'
        if key:
            values=nums(tail)
            if len(values)>=3:rowmap[key]=values[:3]
    # The 2018 table omits blank cells on a zero row. Its nonzero actual
    # investment earnings appear in column three, established by page inspection.
    if year==2018:
        rowmap['disposal']=[100000,100000,70318]
        rowmap['interest']=[0,0,18235]
        rowmap['security_expense']=[4000,4000,0]
        rowmap['capital']=[0,0,21520]
    if year==2020:rowmap['disposal']=[0,0,491564]
    for k in LABELS:rowmap.setdefault(k,[0,0,0])
    out=dict(year=year, fy=f'{year-1}–{str(year)[2:]}',source=source(sid,i+1), values={})
    for idx,basis in enumerate(['original','final','actual']):
        v={k:a[idx] for k,a in rowmap.items()}
        v['federal']=sum(v[k] for k in FED)
        v['revenue']=v['charges']+v['nonoperating']
        # Verify exact sums against the report's printed totals, not its variances.
        nonop=sum(v[k] for k in FED+['state','interest','disposal','capital'])
        assert nonop==v['nonoperating'],(year,basis,'nonoperating',nonop,v['nonoperating'])
        assert sum(v[k] for k in ['food_expense','plant_expense','security_expense'])==v['expenses'],(year,basis,'expenses')
        assert v['revenue']+v['transfers']-v['expenses']==v['net_change'],(year,basis,'net',v)
        out['values'][basis]=v
    return out

def government(year):
    sid=f'acfr-{year}'
    pages=(ROOT/'sources'/f'{sid}.txt').read_text().split('\f')
    i=next(i for i,t in enumerate(pages) if 60<i<100 and re.search(r'5900\s+Federal',t,re.I))
    t=pages[i]
    line=next(l for l in t.splitlines() if re.search(r'5900\s+Federal',l,re.I))
    vals=nums(re.sub(r'^\s*5900','',line))
    # 2016–17 have the total on the same page. Later C-3 tables continue.
    if year<=2017: total=vals[-1];assert total==sum(vals[:-1])
    else:
        total=sum(vals)
        assert f'{total:,}' in pages[i+1],(year,'C-3 continuation total')
    return dict(year=year, federal=total, general_federal=vals[0],
                source=source(sid,i+1), continuation_page=i+2 if year>=2018 else None)

FUNCTIONS={'11':'Instruction','12':'Libraries & media','13':'Curriculum & staff development',
 '21':'Instructional leadership','23':'School leadership','31':'Guidance & evaluation',
 '32':'Social work','33':'Health services','34':'Transportation','35':'Food services',
 '36':'Student activities','41':'General administration','51':'Plant maintenance',
 '52':'Security','53':'Data processing','61':'Community services','71':'Debt service',
 '81':'Facilities & construction','91':'Contracted instruction','92':'Chapter 41 costs',
 '93':'Shared services','94':'Other schools','95':'Juvenile justice AEP',
 '96':'Charter schools','97':'Tax increment funds','99':'Other intergovernmental'}

def budget(start):
    # Budget books supply three-fund scope in every recent year except 2026–27,
    # for which only a combined adopted posting is available.
    sid=f'book-{start}' if start<=2025 else f'adopted-{start}'
    pages=(ROOT/'sources'/f'{sid}.txt').read_text().split('\f')
    if start==2025:
        i=15;t=(ROOT/'sources/book-2025-p16.txt').read_text()
        rev=[593744296,374841216,53467386,600000]
        functions={}
        # Manually transcribed from the rendered all-funds table; OCR of its
        # grid is retained, but exact values are checked through fund totals.
        fs=[486260339,10893509,10071313,13569206,51682352,43612794,3643293,
            12194690,22462312,46848797,21466336,25047448,97216671,18781032,
            29925515,4143198,151822237,3365424,9987912,30960,3187301]
        codes=['11','12','13','21','23','31','32','33','34','35','36','41','51','52','53','61','71','81','91','95','99']
        functions=dict(zip(codes,fs));revenue=1022652898;expense=1066212639
        funds={'general':869731863,'nutrition':46758539,'debt':149722237}
        general_federal=7517250
        note='The short adopted posting is General Fund only. Three-fund totals here come from budget book p. 16. Food/debt detail is labeled proposed; no separate adoption certification was located. Page 29 column years are mislabeled; values match p. 16 and the prior budget.'
    elif start<=2024:
        i=next(i for i,t in enumerate(pages) if ('ALL FUNDS' in t.upper()) and '5900' in t)
        t=pages[i]; functions={};rev=[]
        for line in t.splitlines():
            m=re.match(r'\s*(\d{2}|\d{4})\s+(.+)',line)
            if not m:continue
            c,tail=m.groups();parts=re.split(r'\s{2,}',tail)
            v=nums('  '.join(parts[1:]))
            if not v:continue
            # Last two tokens are the reported grand total and percent's
            # fractional component. Remove the percentage before parsing.
            clean=re.sub(r'\s+[\d.]+%\s*$','',tail)
            vs=nums(re.split(r'\s{2,}',clean,maxsplit=1)[-1])
            if c in FUNCTIONS:functions[c]=functions.get(c,0)+vs[-1]
            if c in ['5700','5800','5900','7900']:rev.append(vs[-1])
        def total_line(label):
            line=next(l for l in t.splitlines() if l.strip().lower().startswith(label))
            return nums(re.sub(r'\s+[\d.]+%\s*$','',line))
        revenue=total_line('total revenues')[-1]
        ex=total_line('total expenditures');expense=ex[-1]
        funds=dict(zip(['general','nutrition','debt'],ex[:3]))
        general_federal={2022:29419955,2023:16385807,2024:16403057}[start]
        note='Budget book three-fund plan; includes General, Food Service, and Debt Service funds. Grant funds and bond construction funds are outside this scope.'
        if start==2024:note+=' Its federal summary includes $45,501,350 of food service Other Resources, which also contains nonfederal items. It is not a pure federal funding total.'
    else:
        i=0;t=pages[0];functions={}
        rev=[596480769,399475770,52922449,0];revenue=1048878988;expense=1098722601
        for line in t.splitlines():
            m=re.match(r'\s*(?:\*{1,2}\s*)?(\d{2})\s+.*?\$([\d,]+)',line)
            if m:
                c,value=m.groups();functions[c]=functions.get(c,0)+int(value.replace(',',''))
        # The wrapped function-91 description is printed on the preceding line.
        functions['91']=7662000
        funds=None;general_federal=None
        note='Combined adopted posting; separate fund totals and nutrition revenue programs are not itemized. Federal classification cannot be reconciled to detailed nutrition programs from this document.'
    residual=revenue-sum(rev)
    assert abs(residual)<=1,(start,'revenues',rev,revenue)
    exp_residual=expense-sum(functions.values())
    assert abs(exp_residual)<=1,(start,'functions',sum(functions.values()),expense,functions)
    if funds:assert sum(funds.values())==expense
    return dict(start=start,year=start+1,fy=f'{start}–{str(start+1)[2:]}',
                source=source(sid,i+1),revenue=revenue,expense=expense,
                revenues=dict(zip(['local','state','reported_federal','other'],rev)),
                functions=functions,funds=funds,general_federal=general_federal,note=note,
                revenue_reconciliation=residual,expenditure_reconciliation=exp_residual)

def main():
    data=dict(as_of='2026-11-06',nutrition=[nutrition(y) for y in range(2016,2026)],
              government=[government(y) for y in range(2016,2026)],
              budgets=[budget(y) for y in range(2022,2027)],
              sources=MANIFEST,labels=LABELS,functions=FUNCTIONS)
    (ROOT/'data.json').write_text(json.dumps(data,indent=2)+'\n')
    with (ROOT/'nutrition.csv').open('w') as f:
        w=csv.writer(f);w.writerow(['fiscal_year_ended','basis','measure','dollars','source_url','pdf_page'])
        for d in data['nutrition']:
            for basis,v in d['values'].items():
                for key,value in v.items():w.writerow([d['year'],basis,key,value,SOURCES[d['source']['id']]['url'],d['source']['page']])
    print('Verified',len(data['nutrition']),'nutrition years × 3 bases; 10 governmental federal totals; 5 three-fund budgets.')

if __name__=='__main__':main()
