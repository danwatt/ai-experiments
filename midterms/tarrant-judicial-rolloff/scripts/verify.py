"""Check normalized results against the separately published county cumulative PDFs."""
from pathlib import Path
import re
import subprocess
import pandas as pd
from analyze import write_zipped_csv

ROOT=Path(__file__).resolve().parents[1]

def norm(s):
    s=re.sub(r',?\s*Vote For \d+.*','',s,flags=re.I)
    return re.sub(r'[^a-z0-9]','',s.lower())

def main():
    contests=pd.read_csv(ROOT/'outputs/contests.csv.zip')
    checks=[]
    for year,g in contests.groupby('year'):
        pdf=ROOT/f'data/raw/{year}-cumulative.pdf'
        txt=pdf.with_suffix('.txt')
        subprocess.run(['pdftotext','-layout',str(pdf),str(txt)],check=True)
        lines=txt.read_text().splitlines()
        normalized=[norm(s) for s in lines]
        for c in g.itertuples():
            matches=[i for i,s in enumerate(normalized) if s==norm(c.contest)]
            if not matches:
                checks.append(dict(year=year,contest=c.contest,check='PDF title match',result='unmatched'))
                continue
            start=matches[0]
            section=lines[start:start+90]
            cast=next((s for s in section if 'Cast Votes:' in s),None)
            if not cast:
                checks.append(dict(year=year,contest=c.contest,check='PDF cast votes',result='unmatched'))
                continue
            m=re.search(r'([\d,]+)\s+[\d.]+%\s*$',cast)
            assert m,(year,c.contest,cast)
            value=int(m[1].replace(',',''))
            # Rejected and unassigned write-ins occur in newer tally exports, but not valid cast votes in PDFs.
            ok=value==c.named_candidate_votes
            checks.append(dict(year=year,contest=c.contest,check='PDF named-candidate vote total',
                               pdf_value=value,export_value=c.named_candidate_votes,result='pass' if ok else 'DIFFERENCE'))
    out=pd.DataFrame(checks)
    write_zipped_csv(out,ROOT/'outputs/verification.csv.zip')
    print(out.groupby(['year','result']).size().to_string())
    print(out[out.result!='pass'].to_string(index=False))
    assert not (out.result=='DIFFERENCE').any()

if __name__=='__main__':main()
