"""Local HTTP fixture tests only: no real endpoint, credentials or model requests."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

class AcceptanceReceiptTests(unittest.TestCase):
    def run_fixture(self, receipt_status, include_result=True):
        calls = []
        key = 'synthetic-fixture-key-not-a-real-credential'
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def respond(self, code, payload):
                raw = json.dumps(payload).encode()
                self.send_response(code);self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
            def do_GET(self):
                calls.append(('GET',self.path))
                if self.headers.get('Authorization') != 'Bearer '+key:
                    return self.respond(401,{})
                if self.path == '/v1/capabilities':
                    return self.respond(200,{'object':'hermes.api_server.capabilities',
                        'auth':{'type':'bearer','required':True},
                        'features':{'run_submission':True,'run_status':True,'run_stop':True,
                                    'runs_idempotency':{'supported':True,'durable':True,'retention_seconds':86400}}})
                if self.path == '/v1/toolsets':return self.respond(200,{'data':[{'enabled':False}]})
                if self.path == '/v1/runs/run_fixture':
                    result={'run_id':'run_fixture','status':'completed'}
                    if include_result:result['output']=json.dumps({'summary':'Harmless fixture result.'})
                    return self.respond(200,result)
                return self.respond(404,{})
            def do_POST(self):
                calls.append(('POST',self.path))
                self.rfile.read(int(self.headers.get('Content-Length','0')))
                if self.headers.get('Authorization') != 'Bearer '+key:return self.respond(401,{})
                if self.path != '/v1/runs':return self.respond(404,{})
                # Same shape as pinned upstream _accepted_response: deliberately no output.
                return self.respond(202,{'run_id':'run_fixture','status':receipt_status,'replayed':True})
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with tempfile.TemporaryDirectory(prefix='ary-hermes-http-fixture-') as directory:
                envfile=Path(directory,'fixture.env');envfile.write_text('API_SERVER_KEY='+key+'\n');envfile.chmod(0o600)
                run=subprocess.run([sys.executable,str(Path(__file__).with_name('local-acceptance.py')),
                    '--base-url',f'http://127.0.0.1:{server.server_port}','--env-file',str(envfile),
                    '--submit','--idempotency-key','synthetic-replay-key'],capture_output=True,text=True,timeout=10)
                report=json.loads(run.stdout)
                return run.returncode,report,calls
        finally:
            server.shutdown();server.server_close();thread.join(timeout=2)
    def test_terminal_replay_receipt_fetches_actual_result(self):
        code,report,calls=self.run_fixture('completed')
        self.assertEqual(code,0);self.assertTrue(report['success'])
        self.assertTrue(report['checks']['initial_status_identity'])
        self.assertEqual(calls.count(('GET','/v1/runs/run_fixture')),1)
        self.assertEqual(calls.count(('POST','/v1/runs')),2)
    def test_nonterminal_receipt_fetches_actual_result(self):
        code,report,calls=self.run_fixture('started')
        self.assertEqual(code,0);self.assertTrue(report['checks']['diagnostic_completed'])
        self.assertEqual(calls.count(('GET','/v1/runs/run_fixture')),1)
    def test_completed_status_without_persisted_result_fails_closed(self):
        code,report,calls=self.run_fixture('completed',include_result=False)
        self.assertEqual(code,2);self.assertFalse(report['success'])
        self.assertFalse(report['inference_verified'])
        self.assertEqual(report['error'],'check_failed:diagnostic_completed')
        self.assertEqual(calls.count(('GET','/v1/runs/run_fixture')),1)

if __name__=='__main__':unittest.main()
