"""Run after recycling-rounds.sql in a disposable local klicseo_rounds_* database."""
import concurrent.futures
import json
import subprocess
import sys

name = sys.argv[1]
if not name.startswith("klicseo_rounds_"):
    raise SystemExit("Use a disposable klicseo_rounds_* database")
command = ["psql", "-h", "/tmp", "-p", "55439", "-d", name, "-v", "ON_ERROR_STOP=1", "-Atq"]


def dispatch(request_id, recipient):
    sql = """begin;
    lock table lead_lists,lead_list_items in share row exclusive mode;
    select pg_sleep(0.3);
    select allocate_recycle_round(
      '{"allocation":true,"include_assigned":true,"services":["ParallelTest"]}',
      3,array[md5('%s')::uuid],null,null,'{}','manual','Concurrency test','%s');
    commit;""" % (recipient, request_id)
    result = subprocess.run(command, input=sql, text=True, capture_output=True, check=True)
    return json.loads(result.stdout.strip())


with concurrent.futures.ThreadPoolExecutor(2) as executor:
    first = executor.submit(dispatch, "parallel-a", "b")
    second = executor.submit(dispatch, "parallel-b", "b")
    a, b = first.result(), second.result()
assert len(a["leadIds"]) == len(b["leadIds"]) == 3
assert set(a["leadIds"]).isdisjoint(b["leadIds"]), "Concurrent requests overlapped"
with concurrent.futures.ThreadPoolExecutor(2) as executor:
    first = executor.submit(dispatch, "parallel-retry", "c")
    second = executor.submit(dispatch, "parallel-retry", "c")
    assert first.result() == second.result(), "Concurrent retries must return one receipt"
check = """do $$ begin
  assert (select count(*) from lead_recycle_events where request_id in ('parallel-a','parallel-b'))=6;
  assert (select count(*) from lead_recycle_events where request_id='parallel-retry')=3;
end $$;"""
subprocess.run(command, input=check, text=True, check=True)
print("Concurrent batches are disjoint; concurrent retries commit exactly once.")
