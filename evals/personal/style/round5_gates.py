"""Frozen comparison criteria, shared by selection and independent validation."""
from style_analysis import DIMS

TARGETS = ['required_content_or_boundary', 'unnecessary_question', 'repeated_closing']
PROTECTED = TARGETS + ['overinterpretation']


def net(analysis, metric):
    counts = analysis['outcomes'][metric]
    return counts.get('patched', 0) - counts.get('control', 0)


def new_majors(analysis):
    return [{'caseId': p['caseId'], 'dimension': dim,
             'evidence': p['conditions']['patched'][dim]['evidenceByOrder']}
            for p in analysis['pairs'] for dim in DIMS
            if len(p['conditions']['patched'][dim]['majorEitherOrder']) > len(p['conditions']['control'][dim]['majorEitherOrder'])]


def development_eligible(analysis):
    return not new_majors(analysis) and all(
        analysis['metrics'][dim]['patched']['bothOrders']['replies'] <= analysis['metrics'][dim]['control']['bothOrders']['replies']
        for dim in PROTECTED) and net(analysis, 'overall') >= 0 and net(analysis, 'naturalness') >= 0


def independent_gate(analysis, eligible):
    metrics = analysis['metrics']
    gates = {'developmentEligible': eligible,
             'noCandidateMajorEitherOrder': all(not p['conditions']['patched'][dim]['majorEitherOrder'] for p in analysis['pairs'] for dim in DIMS),
             'positiveGuardsPreserved': all(not p['conditions']['patched'][dim]['eitherOrder'] for p in analysis['pairs'] if '-G' in p['caseId'] for dim in PROTECTED),
             'overallNetNonnegative': net(analysis, 'overall') >= 0,
             'naturalnessNetNonnegative': net(analysis, 'naturalness') >= 0}
    for dim in PROTECTED:
        gates[dim + 'RepliesNonincrease'] = metrics[dim]['patched']['bothOrders']['replies'] <= metrics[dim]['control']['bothOrders']['replies']
    decrease = sum(metrics[d]['control']['bothOrders']['replies'] - metrics[d]['patched']['bothOrders']['replies'] for d in TARGETS)
    gates['positiveImprovementEvidence'] = decrease >= 1 or net(analysis, 'overall') >= 1
    gates['passed'] = all(gates.values())
    return gates
