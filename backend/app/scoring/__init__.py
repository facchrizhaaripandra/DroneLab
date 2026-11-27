"""Scoring plugins. Importing this package registers every scorer."""

from app.scoring import (  # noqa: F401  (registers scorers)
    m1_sar,
    m2_photo,
    m3_agri,
    m4_delivery,
    m5_inspection,
)
from app.scoring.base import SCORERS, Scorer, ScoringContext, score_run, sort_log

__all__ = ["SCORERS", "Scorer", "ScoringContext", "score_run", "sort_log"]
