"""Run inside the pinned Hermes image: real resolver, disposable config, no network/key.
This is an offline credential-resolution check, not an inference test.
"""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from unittest.mock import patch

# Discard inherited runtime secrets before importing any upstream module.
os.environ.clear()
os.environ['PATH'] = os.defpath
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ['HERMES_IGNORE_RULES'] = '1'
os.environ['HERMES_DISABLE_LAZY_INSTALLS'] = '1'
with tempfile.TemporaryDirectory(prefix='ary-env-resolver-') as fixture:
    os.environ['HERMES_HOME'] = fixture
    Path(fixture, 'config.yaml').write_text(json.dumps({
        'model': {'provider':'openai-api','default':'gpt-5.6-sol'},
        'platform_toolsets': {'api_server':[]}, 'plugins':{'enabled':[]},
        'mcp_servers':{}, 'hooks':{}, 'memory':{'memory_enabled':False,'user_profile_enabled':False},
        'auxiliary': {'title_generation':{'enabled':False}}, 'compression':{'enabled':False},
    }))
    spec = importlib.util.spec_from_file_location('ary_restricted', Path(__file__).with_name('api-only.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    import hermes_cli.runtime_provider as upstream
    import hermes_cli.auth as auth
    resolver = module.env_only_resolver(
        upstream.resolve_runtime_provider, provider='openai-api', key_env='OPENAI_API_KEY',
        model='gpt-5.6-sol', environ={'OPENAI_API_KEY':'sk-fixture-not-a-real-api-key'})
    with patch.object(upstream, 'load_pool', side_effect=AssertionError('pool path forbidden')) as pool, \
         patch.object(auth, '_save_auth_store', side_effect=AssertionError('auth persistence forbidden')) as save, \
         patch('socket.socket.connect', side_effect=AssertionError('network forbidden')):
        for _ in range(2):
            result = resolver(requested='openai-api', target_model='gpt-5.6-sol')
            if result.get('provider') != 'openai-api' or result.get('credential_pool') is not None:
                raise AssertionError('unexpected resolver output')
        if pool.called or save.called or Path(fixture, 'auth.json').exists():
            raise AssertionError('credential cache or pool was used')
    print(json.dumps({'offline_upstream_resolver':'passed','calls':2,
                      'pool_calls':0,'auth_writes':0,'network_calls':0,'inference_verified':False}))
