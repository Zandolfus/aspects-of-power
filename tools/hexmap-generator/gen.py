"""
Resumable map batch runner.

Records completed hexes and skips them on re-run, so a dropped batch is fixed by
running the same command again.

  python3 gen.py 34 8  34 7           # explicit hexes
  python3 gen.py --region "The Ancient Forest" --limit 6
  python3 gen.py --stale              # rebuild anything from an older generator
  python3 gen.py 34 8 --force         # rebuild regardless
"""
import sys, os, json, glob, time, importlib

OUT = os.environ.get("AOP_MAPS", "/mnt/user-data/outputs")
sys.path.insert(0, os.path.join(OUT, "generator"))
MANIFEST = f"{OUT}/manifest.json"
GENERATOR = "hexmap 0.7"


def scan_existing():
    """Rebuild state from the files actually on disk, so the manifest can never
    disagree with reality."""
    found = {}
    for f in glob.glob(f"{OUT}/hex_*.uvtt"):
        try:
            u = json.load(open(f))
        except Exception:
            continue
        xa = u.get("x_area")
        if not xa:
            continue
        found[f"{xa['hex'][0]},{xa['hex'][1]}"] = {
            "file": os.path.basename(f),
            "generator": u.get("x_build", {}).get("generator", "?"),
            "build": u.get("x_build", {}).get("image_id", "?"),
            "terrain": u.get("x_build", {}).get("terrain", "?"),
            "infest": u.get("x_build", {}).get("infest", 0),
            "segments": sum(len(p) - 1 for p in u["line_of_sight"])}
    return found


def main(argv):
    import hexmap
    from world import neighbours
    found = scan_existing()

    if "--stale" in argv:
        try:
            ov = json.load(open(f"{OUT}/overrides.json"))["infestation"]
        except Exception:
            ov = {}
        targets = []
        for k, v in found.items():
            c, r = map(int, k.split(","))
            if v["generator"] != GENERATOR or abs(v.get("infest", 0) - ov.get(k, 0)) > 1e-6:
                targets.append((c, r))
        print(f"{len(targets)} map(s) stale")
    elif "--region" in argv:
        region = argv[argv.index("--region") + 1]
        limit = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else 999
        d = json.load(open(f"{OUT}/hexes.json"))
        built = {tuple(map(int, k.split(","))) for k in found}
        inreg = {(h["col"], h["row"]) for h in d["hexes"] if h["region"] == region}
        front = {}
        for k in built & inreg:
            for n in neighbours(*k).values():
                if n in inreg and n not in built:
                    front[n] = front.get(n, 0) + 1
        if not front:
            front = {k: 0 for k in list(inreg)[:limit]}
        targets = sorted(front, key=lambda k: -front[k])[:limit]
    else:
        nums = [a for a in argv if a.isdigit()]
        targets = [(int(nums[i]), int(nums[i + 1])) for i in range(0, len(nums) - 1, 2)]

    force = "--force" in argv or "--stale" in argv
    todo = [t for t in targets if force or f"{t[0]},{t[1]}" not in found]
    print(f"targets {len(targets)}, to render {len(todo)}: {todo}")

    for n, (c, r) in enumerate(todo, 1):
        superseded = sorted(glob.glob(f"{OUT}/hex_{c}_{r}_*"))
        t0 = time.time()
        try:
            importlib.reload(hexmap)
            hexmap.main(c, r)
        except Exception as e:
            print(f"  !! ({c},{r}) FAILED: {type(e).__name__}: {e}")
            continue
        # ⚠ The generator is deterministic: re-rendering a hex with --force
        # yields an identical image, an identical hash, and therefore the SAME
        # filename. Never delete by "existed before" — identify the build that
        # is now current and delete only paths belonging to other builds.
        now = scan_existing().get(f"{c},{r}")
        keep = f"hex_{c}_{r}_{now['build']}" if now else None
        for p in superseded:
            if keep and os.path.basename(p).startswith(keep):
                continue
            if os.path.exists(p):
                os.remove(p)
        json.dump({"generator": GENERATOR, "maps": scan_existing()}, open(MANIFEST, "w"), indent=1)
        print(f"  [{n}/{len(todo)}] ({c},{r}) done in {time.time()-t0:.0f}s")

    final = scan_existing()
    print(f"\nmanifest: {len(final)} maps, {sum(v['segments'] for v in final.values()):,} segments")


if __name__ == "__main__":
    main(sys.argv[1:])
