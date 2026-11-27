"""Replays a stored run several times and checks that every replay gives the stored result.

python tools/replay.py --run-id r_1 [--db data/dronelab.db] [--times 10]
"""

import argparse
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.db.repo import Repo  # noqa: E402
from app.errors import ApiError  # noqa: E402
from app.replay import replay_run  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(BACKEND / "data" / "dronelab.db"))
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--times", type=int, default=10)
    args = parser.parse_args()
    if not Path(args.db).exists():
        print(f"Basis data tidak ditemukan: {args.db}", file=sys.stderr)
        return 2
    repo = Repo(args.db)
    try:
        replies = [replay_run(repo, args.run_id) for _ in range(max(1, args.times))]
    except ApiError as e:
        print(f"{e.code}: {e.message}", file=sys.stderr)
        return 2
    finally:
        repo.close()
    scores = sorted({r["result"]["score"] for r in replies})
    identical = all(r["identical"] and r["result"] == replies[0]["result"] for r in replies)
    print(f"{args.run_id}: {len(replies)} replay, skor {scores}, identik: {identical}")
    return 0 if identical else 1


if __name__ == "__main__":
    raise SystemExit(main())
