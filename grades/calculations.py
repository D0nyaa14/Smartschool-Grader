"""Decimal-only assessment weighting, with rounding left to presentation."""
from decimal import Decimal


def totals(assessments):
    weighted = Decimal(0)
    weight = Decimal(0)
    for assessment in assessments:
        earned, possible, item_weight = (
            assessment["earned"], assessment["possible"], assessment["weight"]
        ) if isinstance(assessment, dict) else (
            assessment.earned, assessment.possible, assessment.weight
        )
        if possible <= 0 or item_weight <= 0 or earned < 0 or earned > possible:
            raise ValueError("Scores and weights are outside the supported range.")
        weighted += earned / possible * item_weight * 100
        weight += item_weight
    return weighted, weight


def percentage(assessments):
    weighted, weight = totals(assessments)
    return weighted / weight if weight else None


def simulate(assessments, future, target):
    weighted, weight = totals(assessments)
    future_weighted, future_weight = totals(future)
    total_weight = weight + future_weight
    projected = (weighted + future_weighted) / total_weight if total_weight else None
    needed = (target * total_weight - weighted) / future_weight if future_weight else None
    status = "no_data" if needed is None else "already" if needed < 0 else "impossible" if needed > 100 else "achievable"
    return {"projected_percentage": projected, "needed_percentage": needed, "target_percentage": target, "status": status}
