import json,sys,numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
sid,x0,x1,z0,z1,name=sys.argv[1],*map(float,sys.argv[2:6]),sys.argv[6]
ymin=float(sys.argv[7]) if len(sys.argv)>7 else -99; ymax=float(sys.argv[8]) if len(sys.argv)>8 else 999
j=json.load(open(f'public/scenes/{sid}/scene.json'))
fig,ax=plt.subplots(figsize=(13,13*(z1-z0)/(x1-x0)))
for c in j['colliders']:
    if c[3]<x0 or c[0]>x1 or c[5]<z0 or c[2]>z1 or c[4]-c[1]<0.3: continue
    if c[4]<ymin or c[1]>ymax: continue
    ax.add_patch(Rectangle((c[0],c[2]),c[3]-c[0],c[5]-c[2],fc=plt.cm.viridis(min(c[4],40)/40),alpha=.35,ec='k',lw=.3))
for f in j.get('fires',[]):
    if x0<f['x']<x1 and z0<f['z']<z1: ax.plot(f['x'],f['z'],'r*'); ax.text(f['x'],f['z'],f"{f['y']:.0f}",fontsize=6,color='r')
ax.set_xlim(x0,x1); ax.set_ylim(z1,z0); ax.set_aspect('equal'); ax.grid(True,alpha=.4)
ax.set_xticks(np.arange(x0,x1+1,5 if x1-x0<120 else 10)); ax.set_yticks(np.arange(z0,z1+1,5 if x1-x0<120 else 10)); ax.tick_params(labelsize=7)
fig.tight_layout(); fig.savefig(f'_to_delete/overview/{name}.png',dpi=80)
