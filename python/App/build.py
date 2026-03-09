"""
Build script: builds the frontend and copies the output into prod/static/.

This script must be run from the ORIGINAL project (where the frontend/ folder
exists alongside prod/). It is NOT needed on a deployment machine -- just copy
the prod/ folder WITH the static/ directory already built.

Usage (from the original project only):
    python build.py
"""

import shutil
import subprocess
import sys
from pathlib import Path

PROD_DIR = Path(__file__).parent
STATIC_DIR = PROD_DIR / "static"

# Look for the frontend directory next to prod/
FRONTEND_DIR = PROD_DIR.parent / "frontend"


def main():
    if not FRONTEND_DIR.exists():
        print("ERROR: frontend/ directory not found next to prod/.")
        print(f"  Expected at: {FRONTEND_DIR}")
        print()
        if STATIC_DIR.exists():
            print("However, static/ already exists -- you can run 'python start.py' directly.")
        else:
            print("This script must be run from the original project directory,")
            print("where the frontend/ source code lives alongside the prod/ folder.")
            print()
            print("If you are on a deployment machine, copy the prod/ folder WITH")
            print("the static/ directory already included. Then just run:")
            print("    python start.py")
        sys.exit(1)

    # Check that node_modules exist
    if not (FRONTEND_DIR / "node_modules").exists():
        print("Installing frontend dependencies...")
        subprocess.run(
            ["npm", "install"],
            cwd=str(FRONTEND_DIR),
            check=True,
            shell=True,
        )

    # Build the frontend
    print("Building frontend...")
    subprocess.run(
        ["npm", "run", "build"],
        cwd=str(FRONTEND_DIR),
        check=True,
        shell=True,
    )

    dist_dir = FRONTEND_DIR / "dist"
    if not dist_dir.exists():
        print(f"ERROR: Build output not found at {dist_dir}")
        sys.exit(1)

    # Clear old static files and copy new ones
    if STATIC_DIR.exists():
        shutil.rmtree(STATIC_DIR)
    shutil.copytree(dist_dir, STATIC_DIR)

    print(f"Frontend built and copied to {STATIC_DIR}")
    print()
    print("To start the production server, run:")
    print("    python start.py")


if __name__ == "__main__":
    main()
