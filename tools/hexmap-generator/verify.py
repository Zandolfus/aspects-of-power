import json, glob, sys, os
import hexmap
OUT=os.environ.get("AOP_MAPS", "/mnt/user-data/outputs")
def orig(c,r):
    f=glob.glob(f"{OUT}/hex_{c}_{r}_*.uvtt")
    return json.load(open(f[0])), f[0]
def check(c,r):
    o,_=orig(c,r)
    want=o["x_build"].get("image_id_png") or o["x_build"]["image_id"]
    got=hexmap.main(c,r)
    new=json.load(open(f"{OUT}/hex_{c}_{r}_{got}.uvtt"))
    same_img = got==want
    same_walls = new["line_of_sight"]==o["line_of_sight"]
    same_assign = new["x_wall_meta"]["assignments"]==o["x_wall_meta"]["assignments"]
    same_area = {k:v for k,v in new["x_area"].items()} == {k:v for k,v in o["x_area"].items()}
    same_env = new["environment"]==o["environment"]
    print(f"  ({c},{r}) {o['x_build']['terrain']:<13} infest={o['x_build'].get('infest',0):.2f} "
          f"img={'OK' if same_img else 'DIFF'} walls={'OK' if same_walls else 'DIFF'} "
          f"assign={'OK' if same_assign else 'DIFF'} area={'OK' if same_area else 'DIFF'} env={'OK' if same_env else 'DIFF'}")
    if got!=want or not same_walls:
        return False
    for p in glob.glob(f"{OUT}/hex_{c}_{r}_{got}*"):
        if os.path.basename(p).startswith(f"hex_{c}_{r}_{got}") and got!=o["x_build"]["image_id"]:
            os.remove(p)
    return True
ok=all([check(*map(int,a.split(","))) for a in sys.argv[1:]])
print("ALL MATCH" if ok else "MISMATCH")
