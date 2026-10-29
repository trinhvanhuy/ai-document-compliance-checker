from checker.models import Verdict, worst


def test_worst_verdict():
    assert worst([Verdict.COMPLIANT, Verdict.NEEDS_REVIEW]) == Verdict.NEEDS_REVIEW
    assert worst([Verdict.NEEDS_REVIEW, Verdict.NON_COMPLIANT]) == Verdict.NON_COMPLIANT
    assert worst([]) == Verdict.COMPLIANT
