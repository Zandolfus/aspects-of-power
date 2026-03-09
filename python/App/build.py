"""
Build script: builds the frontend and copies the output into prod/static/.
Run this once before starting the production server.

Usage:
    python build.py
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

PROD_DIR = Path(__file__).parent
PROJECT_ROOT = PROD_DIR.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
STATIC_DIR = PROD_DIR / "static"


def main():
    # Check that frontend directory exists
    if not FRONTEND_DIR.exists():
        print(f"ERROR: Frontend directory not found at {FRONTEND_DIR}")
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
