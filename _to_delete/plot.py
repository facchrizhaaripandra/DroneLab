import json,sys,numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from matplotlib.collections import PatchCollection
ids=sys.argv[1:]
for sid in ids:
    j=json.load(open(f'public/scenes/{sid}/scene.json'))
    h=j['height']; z=np.array(h['data'],dtype=float).reshape(h['nz'],h['nx'])
    b=j['bounds']
    fig,ax=plt.subplots(figsize=(14,14*(b['maxZ']-b['minZ'])/(b['maxX']-b['minX'])+0.6 if False else 14))
    ext=[h['x0'],h['x0']+h['nx']*h['cell'],h['z0'],h['z0']+h['nz']*h['cell']]
    ax.imshow(z,origin='lower',extent=ext,cmap='terrain',alpha=.9)
    w=j.get('water')
    if w:
        m=np.zeros((w['nz'],w['nx']))
        for r in w['runs']:
            for k in range(3,len(r)): m[r[0],r[1]+k-3]=1
        ax.imshow(np.ma.masked_where(m==0,m),origin='lower',extent=[w['x0'],w['x0']+w['nx']*w['cell'],w['z0'],w['z0']+w['nz']*w['cell']],cmap='Blues',vmin=0,vmax=1.6,alpha=.8)
    pats=[];cols=[]
    for c in j['colliders']:
        if c[4]-c[1]<0.3: continue
        pats.append(Rectangle((c[0],c[2]),c[3]-c[0],c[5]-c[2])); cols.append(c[4])
    pc=PatchCollection(pats,cmap='autumn_r',alpha=.55,linewidths=.2,edgecolors='k'); pc.set_array(np.array(cols)); ax.add_collection(pc)
    for f in j.get('fires',[]): ax.plot(f['x'],f['z'],'r*',ms=6)
    ax.plot(0,0,'wo',ms=9,mec='k'); ax.text(1,1,'H',color='k',weight='bold')
    ax.add_patch(Rectangle((b['minX'],b['minZ']),b['maxX']-b['minX'],b['maxZ']-b['minZ'],fill=False,ec='m',lw=1.5))
    ax.set_xlim(b['minX']-5,b['maxX']+5); ax.set_ylim(b['maxZ']+5,b['minZ']-5)  # z down like the minimap
    ax.set_aspect('equal'); ax.grid(True,alpha=.3)
    step=20 if (b['maxX']-b['minX'])<400 else 50
    ax.set_xticks(range(int(b['minX']//step*step),int(b['maxX'])+1,step)); ax.set_yticks(range(int(b['minZ']//step*step),int(b['maxZ'])+1,step)); ax.tick_params(labelsize=7)
    ax.set_title(f"{sid} bounds x[{b['minX']},{b['maxX']}] z[{b['minZ']},{b['maxZ']}] ground {z.min():.1f}..{z.max():.1f}")
    fig.tight_layout(); fig.savefig(f'_to_delete/overview/{sid}.png',dpi=80); plt.close(fig)
    print(sid,'ok')
