import asyncio
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('restricted', Path(__file__).with_name('api-only.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def safe_agent():
    return SimpleNamespace(enabled_toolsets=[], tools=[], valid_tool_names=set(), _memory_enabled=False,
                           _user_profile_enabled=False, _memory_store=None, _memory_manager=None, compression_enabled=False, _credential_pool=None)

class FakeBase:
    def __init__(self):
        self.created = 0
        self.agent = safe_agent()
        self._site = None
        self._active_run_tasks = {}
        self._stopping_run_ids = set()
        self._background_tasks = set()
        self.closed = False
        self.interrupted = 0
    def _http_route_table(self):
        return [(a,b,None) for a,b in m.ALLOWED] + [('POST','/v1/runs/{run_id}/approval',None)]
    def _create_agent(self, *a, **kw):
        self.created += 1
        return self.agent
    def interrupt_active_runs(self, reason):
        self.interrupted += 1
    def active_agent_work_count(self):
        return sum(not t.done() for t in self._active_run_tasks.values())
    async def disconnect(self):
        self.closed = True

def safe_config():
    return {'model': {'provider': 'openai-api', 'default': 'gpt-5.6-sol'},
            'platform_toolsets': {'api_server': []}, 'toolsets': [], 'plugins': {'enabled': []},
            'mcp_servers': {}, 'hooks': {}, 'hooks_auto_accept': False,
            'memory': {'memory_enabled': False, 'user_profile_enabled': False, 'provider': ''},
            'fallback_providers': [], 'skills': {'external_dirs': [], 'project_discovery': False, 'inline_shell': False},
            'auxiliary': {'title_generation': {'enabled': False}}, 'compression': {'enabled': False}}

class GuardTests(unittest.TestCase):
    def test_restricted_config_accepted(self):
        m.validate_config(safe_config())
    def test_auxiliary_title_enabled_or_missing_rejected(self):
        for value in (True, None, 'false'):
            with self.subTest(value=value):
                config = safe_config(); config['auxiliary']['title_generation']['enabled'] = value
                with self.assertRaises(m.RestrictionError): m.validate_config(config)
        config = safe_config(); del config['auxiliary']
        with self.assertRaises(m.RestrictionError): m.validate_config(config)
    def test_auxiliary_compression_enabled_or_missing_rejected(self):
        for value in (True, None, 'false'):
            with self.subTest(value=value):
                config = safe_config(); config['compression']['enabled'] = value
                with self.assertRaises(m.RestrictionError): m.validate_config(config)
        config = safe_config(); del config['compression']
        with self.assertRaises(m.RestrictionError): m.validate_config(config)
    def test_route_allowlist(self):
        a = m.restricted_adapter_class(FakeBase, lambda: None)()
        self.assertEqual({(r[0],r[1]) for r in a._http_route_table()}, m.ALLOWED)
    def test_route_drift_fails_closed(self):
        class Changed(FakeBase):
            def _http_route_table(self): return []
        with self.assertRaises(m.RestrictionError):
            m.restricted_adapter_class(Changed, lambda: None)()._http_route_table()
    def test_empty_actual_agent_and_background_review_disabled(self):
        a = safe_agent()
        self.assertIs(m.validate_agent(a), a)
        self.assertTrue(a.skip_background_review)
    def test_actual_tools_rejected(self):
        for name,value in [('tools',[{'function':{'name':'terminal'}}]),('enabled_toolsets',['terminal']),
                           ('valid_tool_names',{'terminal'}),('_memory_enabled',True),
                           ('_user_profile_enabled',True),('_memory_store',object()),('_memory_manager',object()),
                           ('compression_enabled',True), ('_credential_pool',object())]:
            with self.subTest(name=name):
                a = safe_agent(); setattr(a,name,value)
                with self.assertRaises(m.RestrictionError): m.validate_agent(a)
    def test_local_acceptance_never_constructs_agent(self):
        a = m.restricted_adapter_class(FakeBase, lambda: None)()
        with patch.dict(os.environ, {'ARY_HERMES_LOCAL_ACCEPTANCE':'1'}):
            with self.assertRaises(m.RestrictionError): a._create_agent()
        self.assertEqual(a.created,0)
    def test_runtime_guard_before_and_after_constructor(self):
        checks=[]
        a = m.restricted_adapter_class(FakeBase, lambda: checks.append('check'))()
        with patch.dict(os.environ, {'ARY_HERMES_LOCAL_ACCEPTANCE':'0'}): a._create_agent()
        self.assertEqual(checks,['check','check'])
    def test_guard_failure_prevents_constructor(self):
        def bad(): raise m.RestrictionError('unsafe')
        a = m.restricted_adapter_class(FakeBase,bad)()
        with patch.dict(os.environ, {'ARY_HERMES_LOCAL_ACCEPTANCE':'0'}):
            with self.assertRaises(m.RestrictionError): a._create_agent()
        self.assertEqual(a.created,0)

class EnvResolverTests(unittest.TestCase):
    def resolver(self, original=None):
        self.calls = []
        def explicit_only(**kwargs):
            self.calls.append(kwargs)
            # Stand-in for upstream explicit-key branch; no pool path should be requested.
            if not kwargs.get('explicit_api_key'): raise AssertionError('load_pool branch reached')
            return {'provider': kwargs['requested'], 'base_url': kwargs['explicit_base_url'],
                    'api_key': kwargs['explicit_api_key'], 'credential_pool': None}
        return m.env_only_resolver(original or explicit_only, provider='openai-api',
            key_env='OPENAI_API_KEY', model='gpt-5.6-sol', environ={'OPENAI_API_KEY':'fixture-key'})
    def test_always_explicit_key_before_pool_path(self):
        resolve = self.resolver()
        self.assertEqual(resolve()['provider'], 'openai-api')
        self.assertEqual(resolve(requested='openai-api')['credential_pool'],None)
        self.assertTrue(all(c['explicit_api_key']=='fixture-key' and c['target_model']=='gpt-5.6-sol' for c in self.calls))
    def test_provider_model_endpoint_and_key_overrides_rejected(self):
        resolve = self.resolver()
        for kwargs in ({'requested':'anthropic'}, {'target_model':'gpt-4o-mini'},
                       {'explicit_base_url':'https://example.com'}, {'explicit_api_key':'other'}):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(m.RestrictionError): resolve(**kwargs)
        self.assertEqual(self.calls, [])
    def test_pool_from_upstream_rejected(self):
        resolve=self.resolver(lambda **kw: {'credential_pool':object()})
        with self.assertRaises(m.RestrictionError):resolve()
    def test_unsupported_mapping_rejected(self):
        with self.assertRaises(m.RestrictionError):
            m.env_only_resolver(lambda **kw: {}, provider='openai', key_env='OPENAI_API_KEY',
                                model='gpt-5.6-sol', environ={})

class DrainTests(unittest.IsolatedAsyncioTestCase):
    async def test_drain_before_database_close(self):
        a=m.restricted_adapter_class(FakeBase,lambda:None)()
        a._active_run_tasks['one']=asyncio.create_task(asyncio.sleep(0.01))
        await a.disconnect(drain_timeout=0.5)
        self.assertTrue(a.closed)
        self.assertTrue(a._ary_draining)
        self.assertIn('one',a._stopping_run_ids)
        self.assertGreater(a.interrupted,0)
    async def test_timeout_preserves_open_database_for_running_thread(self):
        a=m.restricted_adapter_class(FakeBase,lambda:None)()
        task=asyncio.create_task(asyncio.sleep(10));a._active_run_tasks['one']=task
        with self.assertRaises(m.ShutdownIncomplete):await a.disconnect(drain_timeout=0)
        self.assertFalse(a.closed)
        task.cancel()
        await asyncio.gather(task,return_exceptions=True)
    async def test_background_bookkeeping_cancelled(self):
        a=m.restricted_adapter_class(FakeBase,lambda:None)()
        task=asyncio.create_task(asyncio.sleep(10));a._background_tasks.add(task)
        await a.disconnect()
        self.assertTrue(task.cancelled());self.assertTrue(a.closed)

if __name__=='__main__':unittest.main()
