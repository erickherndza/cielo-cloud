#!/usr/bin/env python3
"""Genera las plantillas oficiales recortadas (public/plantillas/*.xlsm).

Toma las plantillas publicadas por la TSS y el Ministerio de Trabajo y recorta las
filas vacías (65.000 filas con formato) para que pesen poco. Conserva macros,
estilos, validaciones, comentarios, logos y hojas ocultas. Elimina calcChain.xml
(Excel lo reconstruye solo; si quedara apuntando a filas borradas daría error).
Uso: python3 scripts/build-plantillas.py <am.xlsm> <general.xlsm>
"""
import re, sys, zipfile

def recortar(src, dst, limite_filas):
    zin = zipfile.ZipFile(src)
    zout = zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED, compresslevel=9)
    for it in zin.infolist():
        name = it.filename
        if name == 'xl/calcChain.xml':
            continue
        data = zin.read(name)
        if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', name):
            t = data.decode('utf8')
            m = re.search(r'<row r="%d"[ >]' % (limite_filas + 1), t)
            if m:
                fin = t.index('</sheetData>')
                t = t[:m.start()] + t[fin:]
                t = re.sub(r'<dimension ref="([A-Z]+)(\d+):([A-Z]+)\d+"/>', lambda x: '<dimension ref="%s%s:%s%d"/>' % (x.group(1), x.group(2), x.group(3), limite_filas), t, count=1)
            data = t.encode('utf8')
        elif name == '[Content_Types].xml':
            data = re.sub(rb'<Override PartName="/xl/calcChain.xml"[^>]*/>', b'', data)
        elif name == 'xl/_rels/workbook.xml.rels':
            data = re.sub(rb'<Relationship [^>]*calcChain[^>]*/>', b'', data)
        elif name == 'xl/workbook.xml':
            data = re.sub(rb'<calcPr ([^>]*?)/>', rb'<calcPr \1 fullCalcOnLoad="1"/>', data, count=1)
        zout.writestr(it, data)
    zout.close()

if __name__ == '__main__':
    recortar(sys.argv[1], 'public/plantillas/autodeterminacion.xlsm', 600)
    recortar(sys.argv[2], 'public/plantillas/dgt.xlsm', 5300)
