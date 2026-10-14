from pathlib import Path

def pdf(path, annotations):
    stream=b'BT /F1 20 Tf 50 740 Td (PDF review sample) Tj 0 -40 Td /F1 12 Tf (Native comments and replies for a project review.) Tj ET'
    objs=[b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>', ('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots ['+' '.join(f'{i+6} 0 R' for i in range(len(annotations)))+'] >>').encode(), b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
    objs += [a.encode() for a in annotations]
    out=b'%PDF-1.7\n'; offsets=[0]
    for i,obj in enumerate(objs,1):
        offsets.append(len(out)); out += f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
    start=len(out); out += f'xref\n0 {len(objs)+1}\n0000000000 65535 f \n'.encode()
    out += b''.join(f'{o:010} 00000 n \n'.encode() for o in offsets[1:])
    out += f'trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode()
    path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(out)

base=Path(__file__).parent/'sample-notes'/'probe'
pdf(base/'review-links-fixture.pdf',[
    '<< /Type /Annot /Subtype /Text /Rect [40 640 60 660] /T (Alice) /Contents (Parent review) /M (D:20261001100000Z) /NM (parent) /P 3 0 R >>',
    '<< /Type /Annot /Subtype /Text /Rect [70 640 90 660] /T (Bob) /Contents (First reply) /M (D:20261001110000Z) /IRT 6 0 R /RT /R /NM (reply) /P 3 0 R >>',
    '<< /Type /Annot /Subtype /Text /Rect [100 640 120 660] /T (Cara) /Contents (Nested reply) /M (D:20261001120000Z) /IRT 7 0 R /RT /R /NM (nested) /P 3 0 R >>',
    '<< /Type /Annot /Subtype /Popup /Rect [40 400 240 600] /Parent 6 0 R /P 3 0 R >>',
    '<< /Type /Annot /Subtype /Text /Rect [130 640 150 660] /T (Alice) /Contents (Parent review) /IRT 6 0 R /RT /Group /P 3 0 R >>'
])
pdf(base/'edge-cases.pdf',[
    '<< /Type /Annot /Subtype /Text /Rect [40 600 60 620] /Contents (Missing parent reply) /IRT 99 0 R /M (bad date) /P 3 0 R >>',
    '<< /Type /Annot /Subtype /Text /Rect [70 600 90 620] /T (Dana) /Contents (Cycle record one) /IRT 8 0 R /P 3 0 R >>',
    '<< /Type /Annot /Subtype /Text /Rect [100 600 120 620] /T (Eli) /Contents (Cycle record two) /IRT 7 0 R /P 3 0 R >>',
    '<< /Type /Annot /Subtype /Text /Rect [130 600 150 620] /T (Finn) /Contents (# Heading | <script>alert\\(1\\)</script>) /P 3 0 R >>'
])
pdf(base/'empty.pdf',[])
