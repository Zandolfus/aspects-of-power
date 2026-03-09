"""
Start the AoP Stat Validator production server.
Serves both the API and the frontend from a single process.

Usage:
    python start.py [--host HOST] [--port PORT]

Defaults to http://localhost:8000
"""

import argparse
import os
import sys
from pathlib import Path

# Ensure we can import from this directory
os.chdir(Path(__file__).parent)


def main():
    parser = argparse.ArgumentParser(description="AoP Stat Validator")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to (default: 8000)")
    args = parser.parse_args()

    static_dir = Path(__file__).parent / "static"
    if not static_dir.exists():
        print("ERROR: static/ directory not found.")
        print("Run 'python build.py' first to build the frontend.")
        sys.exit(1)

    try:
        import uvicorn
    except ImportError:
        print("ERROR: uvicorn not installed.")
        print("Run: pip install -r requirements.txt")
        sys.exit(1)

    print(f"Starting AoP Stat Validator at http://{args.host}:{args.port}")
    uvicorn.run("main:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
