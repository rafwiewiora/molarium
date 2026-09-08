#!/usr/bin/env python3
"""Reconstruct the four-box manuscript diagram with one tangential arrowhead.

The original figure's text, four-stage sequence, palette, and feedback meaning
are unchanged. Vector source makes future arrow/typography edits reproducible.
"""
from pathlib import Path
import argparse, hashlib, json, math, subprocess
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

STAGES = [
    ('Scientist identifies', ['wrong shape','bad interaction','strained geometry','new method']),
    ('Agent implements', ['representation','numerical kernel','protocol','interface']),
    ('Independent check', ['OpenMM','TorchANI','finite differences','fixed fixtures']),
    ('Repository keeps', ['method + tests','benchmark boundaries','limitations','provenance']),
]

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--latin-modern',action='store_true',help='Use manuscript-matched embedded Latin Modern through LaTeX.')
    a=p.parse_args()
    a.output.parent.mkdir(parents=True,exist_ok=True)
    pdf=a.output.with_suffix('.pdf')
    geometry_pdf = pdf.with_name(pdf.stem+'.geometry.pdf') if a.latin_modern else pdf
    c=canvas.Canvas(str(geometry_pdf),pagesize=(750,213),invariant=1)
    c.setTitle('The scientist-agent build loop')
    c.setAuthor('Molarium manuscript: reproducible vector diagram')
    teal=HexColor('#008A8D')
    c.setFillColorRGB(1,1,1); c.rect(0,0,750,213,fill=1,stroke=0)
    xs=[17,199,382,565]; w=165; bottom=110; h=87
    for x,(title,body) in zip(xs,STAGES):
        c.setFillColor(HexColor('#E8F3F6')); c.setStrokeColor(HexColor('#197996')); c.setLineWidth(1)
        c.roundRect(x,bottom,w,h,3,fill=1,stroke=1)
        if not a.latin_modern:
            c.setFillColorRGB(0,0,0); c.setFont('Times-Bold',14)
            c.drawCentredString(x+w/2,176,title)
            c.setFont('Times-Roman',12.5)
            for n,line in enumerate(body): c.drawCentredString(x+w/2,161-12.1*n,line)
    def head(tip,direction,size=7):
        dx,dy=direction; length=math.hypot(dx,dy); dx/=length; dy/=length
        bx,by=tip[0]-size*dx,tip[1]-size*dy
        path=c.beginPath(); path.moveTo(*tip)
        path.lineTo(bx-size*.42*dy,by+size*.42*dx)
        path.lineTo(bx+size*.42*dy,by-size*.42*dx); path.close()
        c.setFillColor(teal); c.drawPath(path,fill=1,stroke=0)
    c.setStrokeColor(teal); c.setLineWidth(1.5)
    for x,next_x in zip(xs,xs[1:]):
        c.line(x+w,153.5,next_x-2,153.5); head((next_x-1,153.5),(1,0),7)
    # One cubic shaft, one triangle tangent to its endpoint. No second shaft.
    path=c.beginPath(); path.moveTo(654,111)
    path.curveTo(632,28,130,28,100,109)
    c.drawPath(path,stroke=1,fill=0); head((100,109),(-30,81),8)
    if not a.latin_modern:
        c.setFillColor(HexColor('#818B9C')); c.setFont('Times-Roman',11)
        c.drawCentredString(375,34,'accepted changes become')
        c.drawCentredString(375,22,'the next scientific starting point')
    c.showPage(); c.save()
    if a.latin_modern:
        lines = [r'\documentclass{article}',r'\usepackage[T1]{fontenc}',r'\usepackage{lmodern}',
                 r'\usepackage[paperwidth=750bp,paperheight=213bp,margin=0bp]{geometry}',
                 r'\usepackage{graphicx,xcolor}',r'\pagestyle{empty}',r'\setlength{\parindent}{0pt}',
                 r'\begin{document}',r'\setlength{\unitlength}{1bp}',r'\noindent\begin{picture}(750,213)',
                 r'\put(0,0){\includegraphics[width=750bp]{'+geometry_pdf.name+'}}']
        def label(x,y,size,text,bold=False,color='black'):
            weight=r'\bfseries' if bold else ''
            lines.append(r'\put('+f'{x},{y}'+r'){\makebox[0pt][c]{\color{'+color+r'}\fontsize{'+str(size)+r'bp}{'+str(size)+r'bp}\selectfont'+weight+' '+text+'}}')
        for x,(title,body) in zip(xs,STAGES):
            label(x+w/2,176,14,title,True)
            for n,line in enumerate(body): label(x+w/2,161-12.1*n,12.5,line)
        lines.append(r'\definecolor{feedbacklabel}{HTML}{818B9C}')
        label(375,34,11,'accepted changes become',color='feedbacklabel')
        label(375,22,11,'the next scientific starting point',color='feedbacklabel')
        lines.extend([r'\end{picture}',r'\end{document}'])
        tex=pdf.with_suffix('.tex')
        tex.write_text('\n'.join(lines)+'\n')
        subprocess.run(['tectonic','--only-cached','--untrusted','--keep-logs',tex.name],cwd=tex.parent,check=True)
    subprocess.run(['pdftoppm','-singlefile','-r','360','-png',str(pdf),str(a.output.with_suffix(''))],check=True)
    record={'schema':'molarium.paper-feedback-figure/v1',
            'builderSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'figureSha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),
            'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),
            'stages':STAGES,'footer':['accepted changes become','the next scientific starting point'],
            'change':'Reconstructed vector diagram; same text/sequence and four-box layout. The feedback arrow has one cubic shaft and one tangential triangular head, without the original spur.',
            'imageEditAttempt':'Built-in image editor produced a clean arrow but changed outer margins; that raster was not used in the paper.'}
    if a.latin_modern:
        record['fontChange']={'from':'Times-Roman / Times-Bold','to':'Latin Modern Roman regular / bold',
            'method':'Same ReportLab vector geometry with native LaTeX text at the original coordinates and sizes.',
            'geometrySha256':hashlib.sha256(geometry_pdf.read_bytes()).hexdigest(),
            'latexSourceSha256':hashlib.sha256(tex.read_bytes()).hexdigest()}
    a.output.with_suffix('.provenance.json').write_text(json.dumps(record,indent=2)+'\n')
    print(a.output)

if __name__=='__main__': main()
