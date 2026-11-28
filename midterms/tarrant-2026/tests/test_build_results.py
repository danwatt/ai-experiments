"""Standard-library fixture tests; these are illustrative numbers, not real 2026 precinct results."""
import gzip
import base64
import io
import json
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import build_results

class ParseTests(unittest.TestCase):
    def test_clarity_xml(self):
        xml='''<?xml version="1.0" encoding="UTF-8"?><ElectionResult><ElectionDate>11/03/2026</ElectionDate><Contest key="gov" text="Governor">
        <Choice key="1" text="Greg Abbott" party="REP" totalVotes="10"><VoteType name="Early Voting" votes="8"><Precinct name="Precinct 4050" votes="8"/></VoteType><VoteType name="Election Day" votes="2"><Precinct name="Precinct 4050" votes="2"/></VoteType></Choice>
        <Choice key="2" text="Gina Hinojosa" party="DEM" totalVotes="12"><VoteType name="Early Voting" votes="9"><Precinct name="4050" votes="9"/></VoteType><VoteType name="Election Day" votes="3"><Precinct name="4050" votes="3"/></VoteType></Choice>
        </Contest></ElectionResult>'''
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'detailxml.zip'
            with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('detail.xml',xml)
            _,names=build_results.read_contests(ROOT/'index.html')
            geo=build_results.geo_ids(ROOT/'data/tarrant_precincts_2026.topojson')
            acc=build_results.Accumulator(names,geo)
            fmt=build_results.parse_source(path,acc)
            rows=acc.output()
            self.assertEqual(fmt['kind'],'Clarity detailed XML')
            self.assertEqual(len(rows),2)
            self.assertIn(['4050',7,0,10,None,8,2],rows)
            self.assertIn(['4050',7,1,12,None,9,3],rows)
            self.assertEqual(acc.unknown, {})

    def test_tabular_spreadsheetml(self):
        uri='urn:schemas-microsoft-com:office:spreadsheet'
        rt=ET.Element('{'+uri+'}Workbook')
        work=ET.SubElement(rt,'{'+uri+'}Worksheet')
        table=ET.SubElement(work,'{'+uri+'}Table')
        for row in (['Precinct','Contest','Candidate','Total','Early','Election Day'],
                    ['4050','Governor','Greg Abbott','10','8','2']):
            el=ET.SubElement(table,'{'+uri+'}Row')
            for val in row:
                c=ET.SubElement(el,'{'+uri+'}Cell')
                d=ET.SubElement(c,'{'+uri+'}Data')
                d.text=val
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'detailxlsx.zip'
            with zipfile.ZipFile(path,'w') as z:z.writestr('detail.xml',ET.tostring(rt))
            # Excel XML is not Clarity even though filename is detail.xml.
            # Pass under a more realistic workbook XML name.
            with zipfile.ZipFile(path,'w') as z:z.writestr('workbook.xml',ET.tostring(rt))
            _,names=build_results.read_contests(ROOT/'index.html')
            acc=build_results.Accumulator(names,{'4050'})
            fmt=build_results.parse_source(path,acc)
            self.assertEqual(fmt['kind'],'XML Spreadsheet')
            self.assertEqual(acc.output(),[['4050',7,0,10,None,8,2]])

    def test_xlsx_worksheet(self):
        xmlns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
        rows=[['Precinct','Contest','Candidate','Total','Mail','Early','Day'],
              ['4050','Governor','Gina Hinojosa','12','0','9','3']]
        rt=ET.Element('{'+xmlns+'}worksheet')
        sheet=ET.SubElement(rt,'{'+xmlns+'}sheetData')
        for ri,row in enumerate(rows,1):
            er=ET.SubElement(sheet,'{'+xmlns+'}row',r=str(ri))
            for i,val in enumerate(row):
                col=chr(ord('A')+i)
                c=ET.SubElement(er,'{'+xmlns+'}c',r=f'{col}{ri}',t='inlineStr')
                v=ET.SubElement(ET.SubElement(c,'{'+xmlns+'}is'),'{'+xmlns+'}t')
                v.text=val
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'detail.xlsx'
            with zipfile.ZipFile(path,'w') as z:
                z.writestr('[Content_Types].xml','<Types/>')
                z.writestr('xl/worksheets/sheet1.xml',ET.tostring(rt))
            _,names=build_results.read_contests(ROOT/'index.html')
            acc=build_results.Accumulator(names,{'4050'})
            build_results.parse_source(path,acc)
            self.assertEqual(acc.output(),[['4050',7,1,12,0,9,3]])

    def test_short_compact_payload_embeds(self):
        with tempfile.TemporaryDirectory() as d:
            d=Path(d)
            inp=d/'votes.json.gz'
            data={'schema':1,'source':'Fixture','rows':[['4050',7,0,10,None,8,2]]}
            inp.write_bytes(gzip.compress(json.dumps(data).encode(),mtime=0))
            out=d/'dashboard.html'
            cmd=[sys.executable,str(ROOT/'scripts/embed_results.py'),'--html',str(ROOT/'index.html'),'--data',str(inp),'--output',str(out)]
            subprocess.run(cmd,check=True,capture_output=True)
            s=out.read_text()
            self.assertIn('embedded-precinct-results-gzip',s)
            self.assertNotIn('file://',s)
            self.assertIn('DecompressionStream',s)

    def test_precinct_strictness(self):
        self.assertEqual(build_results.precinct_id('Precinct 4050'),'4050')
        self.assertEqual(build_results.precinct_id('4050.0'),'4050')
        self.assertIsNone(build_results.precinct_id('County Total'))
        self.assertIsNone(build_results.precinct_id('4050 plus 4051'))

    def test_embed_updates_served_html_by_default(self):
        with tempfile.TemporaryDirectory() as directory:
            directory=Path(directory)
            page=directory/'index.html'
            page.write_text((ROOT/'index.html').read_text())
            payload={'source':'Fixture','rows':[['4050',7,0,10,None,8,2]]}
            data=directory/'votes.json.gz'
            data.write_bytes(gzip.compress(json.dumps(payload).encode(),mtime=0))
            subprocess.run([sys.executable,str(ROOT/'scripts/embed_results.py'),
                            '--html',str(page),'--data',str(data)],check=True,capture_output=True)
            blocks=re.findall(r'<script id="embedded-precinct-results-gzip" type="text/plain">(.*?)</script>',page.read_text(),re.S)
            self.assertEqual(len(blocks),1)
            self.assertEqual(json.loads(gzip.decompress(base64.b64decode(blocks[0]))),payload)

if __name__=='__main__':unittest.main()
