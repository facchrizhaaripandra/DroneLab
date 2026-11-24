# Ekspor ulang satu peta dengan parameter yang sama seperti sebelumnya (judul, catatan, titik spawn, sel, batas AGL
# diambil dari public/scenes/<id>/scene.json). Blender: exec(open(...reexport.py).read()); res = reexport("s6_kota_pengiriman")
import json, os
exec(open(r"D:\DroneLabClaude\dronelab\scripts\blender\export_scene.py").read())


def reexport(scene_id):
    meta = json.load(open(os.path.join(OUT_ROOT, scene_id, "scene.json")))
    sp = meta["spawn_blender"]
    return process(scene_id, meta["title"], (sp[0], sp[1]), cell=meta["height"]["cell"], max_agl=meta.get("maxAgl", 120), notes=meta.get("notes", ""))
