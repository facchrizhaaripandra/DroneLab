import json,random
R2=lambda v: round(float(v),2)
rng=random.Random(7)
FACES=[{'face':'N','nx':0,'nz':-1},{'face':'S','nx':0,'nz':1},{'face':'E','nx':1,'nz':0},{'face':'W','nx':-1,'nz':0}]
def m5(s,cols,rows,ndef,ymin):
    panels=[]
    for f in FACES:
        along=s['w'] if f['nx']==0 else s['d']
        c,r=cols(f),rows(f); hgt=s['y1']-s['y0']
        for i in range(c):
            for j in range(r):
                t=-along/2+(i+0.5)*(along/c)
                panels.append({'id':len(panels)+1,'face':f['face'],'nx':f['nx'],'nz':f['nz'],
                  'x':R2(s['x']+t if f['nx']==0 else s['x']+f['nx']*(s['w']/2+0.1)),'y':R2(s['y0']+(j+0.5)*(hgt/r)),
                  'z':R2(s['z']+f['nz']*(s['d']/2+0.1) if f['nx']==0 else s['z']+t)})
    order=sorted(panels,key=lambda p:rng.random())[:ndef]
    defects=[]
    for i,p in enumerate(order):
        jx=(rng.random()-0.5)*2; jy=(rng.random()-0.5)*2; ax=p['nx']==0
        defects.append({'id':i+1,'kind':'retak' if i%2==0 else 'karat','face':p['face'],'nx':p['nx'],'nz':p['nz'],'size':R2(0.6+rng.random()*1.4),
          'x':R2(p['x']+(jx if ax else 0)),'y':R2(max(s['y0']+ymin,p['y']+jy)),'z':R2(p['z']+(0 if ax else jx))})
    return panels,defects
S={}
st={'x':0,'z':-30,'w':21.7,'d':30.94,'y0':0,'y1':36}
pn,df=m5(st,lambda f:3,lambda f:2,7,6)
S['m5_inspeksi:gedung']={'scene':'s7_inspeksi_gedung','title':'Gedung bertingkat (inspeksi)','brief':'Periksa keempat sisi menara setinggi 36 m. Foto dari jarak 3 sampai 8 m dan tandai setiap cacat.',
 'mission':{'variant':'gedung','structure':st,'panels':pn,'defects':df,'safe':{'min':3,'max':8}}}
st={'x':90,'z':0,'w':112,'d':10.16,'y0':-3.01,'y1':0.72}
pn,df=m5(st,lambda f:6 if f['nx']==0 else 1,lambda f:1,6,0.3)
S['m5_inspeksi:jembatan']={'scene':'s7b_inspeksi_jembatan','title':'Jembatan gantung (inspeksi)','brief':'Periksa kedua sisi dek jembatan gantung dari atas sungai. Foto dari jarak 3 sampai 8 m dan tandai setiap cacat.',
 'mission':{'variant':'jembatan','structure':st,'panels':pn,'defects':df,'safe':{'min':3,'max':8}}}
A={}
for p in ['part1','part2']: A.update(json.load(open(f'_to_delete/{p}.json')))
A.update(S)
body=json.dumps(A,indent=1,ensure_ascii=False)
hdr='''// Data skenario misi utama di peta realistis (public/scenes/<id>): titik korban, api, bidikan, lahan, paket, panel dan cacat.
// Koordinat dunia simulator (pad H di 0, 0, 0), sama dengan scene.json. Bentuk `mission` sama dengan config.mission misi
// prosedural (worldconfig.js), jadi missions.js, scoring.js, vision.js dan agri.js memakainya tanpa perubahan.
// Kunci: "<mission_id>:<varian>". tests/scenarios.test.js memeriksa semua titik terhadap scene.json (batas, collider, jangkauan).
export const SCENARIOS = '''
open('src/scenarios-data.js','w',encoding='utf-8').write(hdr+body+';\n')
print('ok',list(A))
