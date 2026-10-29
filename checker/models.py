from __future__ import annotations

from datetime import date
from enum import Enum

from pydantic import BaseModel, Field


class DocType(str, Enum):
    PASI = "pasi"
    CACES = "caces"
    DRIVING_LICENCE = "driving_licence"
    H0B0 = "h0b0"
    ATEX = "atex"
    OTHER = "other"


class Verdict(str, Enum):
    COMPLIANT = "compliant"
    NON_COMPLIANT = "non_compliant"
    NEEDS_REVIEW = "needs_human_review"


# worst first, used when aggregating
VERDICT_ORDER = [Verdict.NON_COMPLIANT, Verdict.NEEDS_REVIEW, Verdict.COMPLIANT]


def worst(verdicts) -> Verdict:
    verdicts = list(verdicts)
    for v in VERDICT_ORDER:
        if v in verdicts:
            return v
    return Verdict.COMPLIANT


class Evidence(BaseModel):
    page: int | None = None
    quote: str | None = None


class Worker(BaseModel):
    first_name: str
    last_name: str
    # what the worker is going to do on the mission, matched by client rules
    assignment: list[str] = Field(default_factory=list)

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


class CheckResult(BaseModel):
    check: str
    verdict: Verdict
    reason: str
    confidence: float = 1.0
    evidence: list[Evidence] = Field(default_factory=list)


class DocumentReport(BaseModel):
    file: str
    detected_type: DocType
    holder_name: str | None = None
    issue_date: date | None = None
    expiry_date: date | None = None
    verdict: Verdict
    confidence: float
    reasons: list[str]
    checks: list[CheckResult]


class FileReport(BaseModel):
    worker: str
    client: str | None = None
    verdict: Verdict
    confidence: float
    reasons: list[str]
    documents: list[DocumentReport]
    file_checks: list[CheckResult] = Field(default_factory=list)
