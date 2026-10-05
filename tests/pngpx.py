import zlib, struct
def decode(data):
    assert data[:8]==b'\x89PNG\r\n\x1a\n'
    i=8; idat=b''; w=h=0; ct=bd=0
    while i<len(data):
        ln=struct.unpack('>I',data[i:i+4])[0]; typ=data[i+4:i+8]; body=data[i+8:i+8+ln]; i+=12+ln
        if typ==b'IHDR': w,h,bd,ct=struct.unpack('>IIBB',body[:10])
        elif typ==b'IDAT': idat+=body
        elif typ==b'IEND': break
    assert bd==8 and ct in (2,6)
    bpp=3 if ct==2 else 4; raw=zlib.decompress(idat); stride=w*bpp; prev=bytearray(stride); px=[]; o=0
    for y in range(h):
        f=raw[o]; o+=1; line=bytearray(raw[o:o+stride]); o+=stride
        for x in range(stride):
            a=line[x-bpp] if x>=bpp else 0; b=prev[x]; c=prev[x-bpp] if x>=bpp else 0
            if f==1: line[x]=(line[x]+a)&255
            elif f==2: line[x]=(line[x]+b)&255
            elif f==3: line[x]=(line[x]+((a+b)>>1))&255
            elif f==4:
                p=a+b-c; pa=abs(p-a); pb=abs(p-b); pc=abs(p-c)
                pr=a if pa<=pb and pa<=pc else (b if pb<=pc else c); line[x]=(line[x]+pr)&255
        for x in range(w): px.append(tuple(line[x*bpp:x*bpp+3]))
        prev=line
    return w,h,px
def stats(data):
    w,h,px=decode(data); L=[0.2126*r+0.7152*g+0.0722*b for r,g,b in px]
    return {'meanLum':round(sum(L)/len(L),1),'maxLum':round(max(L),1),'nearWhitePct':round(100*sum(1 for v in L if v>=245)/len(L),1)}
