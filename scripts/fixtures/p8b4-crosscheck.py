#!/usr/bin/env python3
"""Block 4 cross-check: the admin overview's own numbers against psql.

Reads the JSON the served API returned (/tmp/b4_overview.json by default) and
asks PostgreSQL the same questions in the same run, then prints them side by
side. A reader can see that the page did not invent a number: every figure in
the JSON has a query next to it, and a mismatch is printed as MISMATCH.

    python3 scripts/fixtures/p8b4-crosscheck.py [overview.json]
"""
import json
import subprocess
import sys

DSN = "postgresql://cinema:cinema_dev_password@localhost:5432/cinema_studio"
PATH_JSON = sys.argv[1] if len(sys.argv) > 1 else "/tmp/b4_overview.json"


def psql(sql: str) -> str:
    out = subprocess.run(
        ["psql", DSN, "-At", "-c", sql], capture_output=True, text=True, check=True
    )
    return out.stdout.strip()


def main() -> int:
    with open(PATH_JSON) as fh:
        overview = json.load(fh)

    rows = [
        ("accounts", overview["counts"][0]["total"], 'SELECT count(*) FROM "User"'),
        ("projects", overview["counts"][1]["total"], 'SELECT count(*) FROM "Project"'),
        ("chapters", overview["counts"][2]["total"], 'SELECT count(*) FROM "Chapter"'),
        ("scenes", overview["counts"][3]["total"], 'SELECT count(*) FROM "Scene"'),
        ("assets", overview["counts"][4]["total"], 'SELECT count(*) FROM "Asset"'),
        ("renderJobs", overview["counts"][5]["total"], 'SELECT count(*) FROM "RenderJob"'),
        ("stageRuns", overview["counts"][6]["total"], 'SELECT count(*) FROM "RenderStageRun"'),
        ("artefacts", overview["counts"][7]["total"], 'SELECT count(*) FROM "RenderArtefact"'),
        (
            "jobs.synthetic",
            overview["jobs"]["synthetic"],
            'SELECT count(*) FROM "RenderJob" WHERE "syntheticProof"',
        ),
        (
            "artefacts.synthetic",
            overview["artefacts"]["synthetic"],
            'SELECT count(*) FROM "RenderArtefact" WHERE "syntheticProof"',
        ),
        (
            "stageRuns.synthetic",
            overview["counts"][6]["synthetic"],
            'SELECT count(*) FROM "RenderStageRun" WHERE "syntheticProof"',
        ),
        (
            "subscriptions with a provider id",
            "false" if not overview["money"]["paymentsPossible"] else "true",
            'SELECT count(*) > 0 FROM "Subscription" WHERE provider IS NOT NULL',
        ),
    ]

    print(f"{'metric':38} | {'admin API':>12} | {'psql':>12} | verdict")
    print("-" * 84)
    bad = 0
    for name, api_value, sql in rows:
        db_value = psql(sql)
        if isinstance(api_value, bool):
            ok = str(api_value).lower() == ("true" if db_value == "t" else "false")
            shown = str(api_value).lower()
        else:
            ok = str(api_value) == db_value
            shown = str(api_value)
        bad += 0 if ok else 1
        print(f"{name:38} | {shown:>12} | {db_value:>12} | {'MATCH' if ok else 'MISMATCH'}")

    # The status breakdown, cross-checked against the stage rows it is derived from.
    print()
    print("derived job status, recomputed in SQL from the stage rows:")
    sql_status = """
    SELECT
      CASE
        WHEN s.runs = 0 THEN 'queued'
        WHEN s.failed > 0 THEN 'failed'
        WHEN s.blocked > 0 THEN 'blocked'
        WHEN s.stopped > 0 THEN 'stopped'
        WHEN s.running > 0 THEN 'running'
        WHEN s.succeeded = 7 THEN 'succeeded'
        ELSE 'running'
      END AS derived, count(*)
    FROM (
      SELECT j.id,
        count(r.*) AS runs,
        count(*) FILTER (WHERE r.state = 'FAILED') AS failed,
        count(*) FILTER (WHERE r.state = 'BLOCKED') AS blocked,
        count(*) FILTER (WHERE r.state = 'STOPPED') AS stopped,
        count(*) FILTER (WHERE r.state = 'RUNNING') AS running,
        count(*) FILTER (WHERE r.state = 'SUCCEEDED') AS succeeded
      FROM "RenderJob" j LEFT JOIN "RenderStageRun" r ON r."jobId" = j.id
      GROUP BY j.id
    ) s GROUP BY 1 ORDER BY 1
    """
    db_status = [line.split("|") for line in psql(sql_status).splitlines() if line]
    api_status = {s["status"]: s["count"] for s in overview["jobs"]["statuses"] if s["count"] > 0}
    print(f"{'status':12} | {'admin API':>10} | {'psql':>10} | verdict")
    print("-" * 52)
    for status, count in sorted(db_status):
        api_count = api_status.get(status)
        ok = api_count == int(count)
        bad += 0 if ok else 1
        print(f"{status:12} | {str(api_count):>10} | {count:>10} | {'MATCH' if ok else 'MISMATCH'}")
    for status in sorted(set(api_status) - {s for s, _ in db_status}):
        bad += 1
        print(f"{status:12} | {api_status[status]:>10} | {'absent':>10} | MISMATCH")

    print()
    print(f"cross-check verdict: {'ALL MATCH' if bad == 0 else f'{bad} MISMATCH(ES)'}")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
