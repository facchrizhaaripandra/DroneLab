import json,numpy as np,math
def load(sid):
    j=json.load(open(f'public/scenes/{sid}/scene.json'))
    h=j['height']; j['_z']=np.array(h['data'],dtype=float).reshape(h['nz'],h['nx'])
    j['_c']=np.array([c for c in j['colliders'] if c[4]-c[1]>=0.3]); return j
def ground(j,x,z):
    h=j['height']; fx=(x-h['x0'])/h['cell']; fz=(z-h['z0'])/h['cell']
    i=int(math.floor(fx)); k=int(math.floor(fz)); i=max(0,min(h['nx']-2,i)); k=max(0,min(h['nz']-2,k))
    tx=min(1,max(0,fx-i)); tz=min(1,max(0,fz-k)); Z=j['_z']
    return (Z[k,i]*(1-tx)+Z[k,i+1]*tx)*(1-tz)+(Z[k+1,i]*(1-tx)+Z[k+1,i+1]*tx)*tz
def hit(j,x,y,z,r=0.5):
    C=j['_c']
    dx=np.maximum(np.maximum(C[:,0]-x,0),x-C[:,3]); dy=np.maximum(np.maximum(C[:,1]-y,0),y-C[:,4]); dz=np.maximum(np.maximum(C[:,2]-z,0),z-C[:,5])
    return bool(np.any(dx*dx+dy*dy+dz*dz<r*r))
def top(j,x,z,ymax=1e9,pad=0.0):
    C=j['_c']; m=(C[:,0]-pad<=x)&(x<=C[:,3]+pad)&(C[:,2]-pad<=z)&(z<=C[:,5]+pad)&(C[:,1]<ymax)
    return float(C[m][:,4].max()) if m.any() else None
def clear_disc(j,x,z,r,hmax=4):
    # no collider within r footprint between ground and hmax
    C=j['_c']; g=ground(j,x,z)
    dx=np.maximum(np.maximum(C[:,0]-x,0),x-C[:,3]); dz=np.maximum(np.maximum(C[:,2]-z,0),z-C[:,5])
    near=(dx*dx+dz*dz<r*r)&(C[:,4]>g+0.3)&(C[:,1]<g+hmax)
    return not bool(near.any())
def water_at(j,x,z):
    w=j.get('water')
    if not w: return False
    i=int((x-w['x0'])//w['cell']); k=int((z-w['z0'])//w['cell'])
    if i<0 or k<0 or i>=w['nx'] or k>=w['nz']: return False
    for r in w['runs']:
        if r[0]==k and r[1]<=i<r[1]+len(r)-3: return True
    return False
