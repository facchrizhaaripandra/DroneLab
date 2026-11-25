import sys,math,json,random; sys.path.insert(0,'_to_delete')
from q import *
R2=lambda v: round(float(v),2)
S={}
L={s:load(s) for s in ['s1_gedung_terbakar','s2_hutan_terbakar']}
def gy(sid,x,z): return R2(ground(L[sid],x,z))
s='s1_gedung_terbakar'
S['m1_sar:gedung']={'scene':s,'title':'Gedung perkantoran terbakar','brief':'Api menjalar di gedung kantor. Cari semua korban sebelum api dan baterai menghabiskan waktu.',
 'mission':{'variant':'gedung','area':{'min':[-40,-85],'max':[60,5]},
  'victims':[{'id':1,'x':-3,'z':-45,'y':16.82},{'id':2,'x':5,'z':-30,'y':gy(s,5,-30)},{'id':3,'x':-10,'z':-30,'y':gy(s,-10,-30)},
             {'id':4,'x':30,'z':-45,'y':gy(s,30,-45)},{'id':5,'x':24,'z':-16,'y':gy(s,24,-16)}],
  'fires':[{'id':1,'x':17.4,'z':-28,'r':6,'y':0},{'id':2,'x':12,'z':-38,'r':5,'y':10},{'id':3,'x':8,'z':-47,'r':5,'y':0}],
  'smoke':[{'id':1,'x':-3,'z':-45,'r':7,'h':26},{'id':2,'x':5,'z':-30,'r':7,'h':26},{'id':3,'x':17.4,'z':-28,'r':9,'h':24},{'id':4,'x':12,'z':-38,'r':9,'h':24}],
  'safe':{'x':-20,'z':-10,'r':4},'markRadius':5}}
s='s2_hutan_terbakar'
fires=[(-21,62,14),(10,93,11),(-36,97,10),(-90,155,16),(46,172,14)]
vic=[(-49,46),(-13,103),(-97,184),(41,208)]
S['m1_sar:hutan']={'scene':s,'title':'Hutan terbakar','brief':'Kebakaran hutan memutus jalur pendaki. Temukan mereka di celah pepohonan dan hindari zona api.',
 'mission':{'variant':'hutan','area':{'min':[-150,20],'max':[80,215]},
  'victims':[{'id':i+1,'x':x,'z':z,'y':gy(s,x,z)} for i,(x,z) in enumerate(vic)],
  'fires':[{'id':i+1,'x':x,'z':z,'r':r,'y':gy(s,x,z)} for i,(x,z,r) in enumerate(fires)],
  'smoke':[{'id':1,'x':vic[0][0],'z':vic[0][1],'r':8,'h':30},{'id':2,'x':vic[1][0],'z':vic[1][1],'r':8,'h':30}]+[{'id':3+i,'x':x,'z':z,'r':r+4,'h':28} for i,(x,z,r) in enumerate(fires)],
  'safe':{'x':11,'z':22,'r':4},'markRadius':5}}
json.dump(S,open('_to_delete/part1.json','w'))
print('part1 ok')
