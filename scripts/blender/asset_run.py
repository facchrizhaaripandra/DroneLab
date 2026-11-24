# One scene: swap trees and cars for the library models, save the next version, export to the website.
import bpy
def run(dst, cars, burnt, sid, title, spawn, cell, agl, notes):
    ap = {}; exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\asset_apply.py").read(), ap)
    at = {}; exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\asset_trees.py").read(), at)
    meshes = ap["append_library"](); G = ap["lib_groups"](meshes, at)
    t = ap["swap_trees"](G, at["group_for"])
    c = ap["swap_cars"](meshes, cars, burnt) if cars else {}
    bpy.ops.wm.save_as_mainfile(filepath=dst)
    ns = {}; exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\export_scene.py").read(), ns)
    r = ns["process"](sid, title, spawn, cell=cell, max_agl=agl, notes=notes)
    return {"trees": t, "cars": c, "glb_mb": r["glb_mb"], "colliders": r["colliders"]}
