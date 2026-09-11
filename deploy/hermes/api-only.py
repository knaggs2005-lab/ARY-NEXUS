"""Pinned upstream API adapter with local restrictions; requires container acceptance.
No GatewayRunner is started. Upstream Runs persistence/execution/cancel remain intact.
"""
import asyncio
import os
import signal
from pathlib import Path

ALLOWED = {
    ('GET', '/health'), ('GET', '/v1/capabilities'), ('GET', '/v1/toolsets'),
    ('POST', '/v1/runs'), ('GET', '/v1/runs/{run_id}'),
    ('GET', '/v1/runs/{run_id}/events'), ('POST', '/v1/runs/{run_id}/stop'),
}

class RestrictionError(RuntimeError):
    pass

class ShutdownIncomplete(RuntimeError):
    pass

def require(condition, message):
    # Never use assert for security: python -O must not remove checks.
    if not condition:
        raise RestrictionError(message)

def validate_config(raw):
    require(raw.get('platform_toolsets', {}).get('api_server') == [], 'API toolsets must be explicitly empty')
    require(raw.get('toolsets') == [], 'Global toolsets must be empty')
    require(raw.get('plugins', {}).get('enabled') == [], 'Plugins must be explicitly empty')
    require(raw.get('mcp_servers') == {} and raw.get('hooks') == {}, 'MCP/hooks must be empty')
    require(raw.get('hooks_auto_accept') is False, 'Hook auto-accept must be disabled')
    memory = raw.get('memory', {})
    require(memory.get('memory_enabled') is False and memory.get('user_profile_enabled') is False, 'Memory must be disabled')
    require(memory.get('provider') == '', 'External memory must be disabled')
    require(raw.get('fallback_providers') == [], 'Fallback providers must be empty')
    require(raw.get('auxiliary', {}).get('title_generation', {}).get('enabled') is False, 'Auxiliary title calls must be disabled')
    require(raw.get('compression', {}).get('enabled') is False, 'Auxiliary compression calls must be disabled')
    require(raw.get('context', {}).get('engine', 'compressor') == 'compressor', 'No plugin context engine allowed')
    skills = raw.get('skills', {})
    require(skills.get('external_dirs') == [] and skills.get('project_discovery') is False
            and skills.get('inline_shell') is False, 'Skill loading/execution must be disabled')
    require('REPLACE_' not in str(raw.get('model')), 'Choose verified provider/model first')

def validate_agent(agent):
    # Names verified from pinned agent/agent_init.py, not guessed API flags.
    require(getattr(agent, 'enabled_toolsets', None) == [], 'Agent effective toolsets are not empty')
    require(getattr(agent, 'tools', None) == [], 'Agent tool schemas are not empty')
    require(getattr(agent, 'valid_tool_names', None) == set(), 'Agent tool names are not empty')
    require(getattr(agent, '_memory_enabled', None) is False, 'Agent memory enabled')
    require(getattr(agent, '_user_profile_enabled', None) is False, 'Agent profile memory enabled')
    require(getattr(agent, '_memory_store', 'missing') is None, 'Agent memory store attached')
    require(getattr(agent, '_memory_manager', 'missing') is None, 'External memory manager attached')
    require(getattr(agent, 'compression_enabled', None) is False, 'Agent auxiliary compression enabled')
    require(getattr(agent, '_credential_pool', 'missing') is None, 'Agent credential pool forbidden')
    # This field is consumed by upstream background-review execution, before run_conversation.
    agent.skip_background_review = True
    require(agent.skip_background_review is True, 'Background review must be disabled')
    return agent

def env_only_resolver(original, *, provider, key_env, model, environ):
    # Exact registry mapping audited at the pinned source revision. Extend only after review.
    require(provider == 'openai-api' and key_env == 'OPENAI_API_KEY', 'Env-only worker currently supports openai-api only')
    base_url = 'https://api.openai.com/v1'
    def resolve(*, requested=None, explicit_api_key=None, explicit_base_url=None, target_model=None):
        require(requested in (None, '', 'auto', provider), 'Client provider override forbidden')
        require(target_model in (None, '', model), 'Client model override forbidden')
        require(explicit_base_url in (None, '', base_url, base_url + '/'), 'Client endpoint override forbidden')
        key = environ.get(key_env, '')
        require(bool(key), 'Approved provider key missing')
        require(explicit_api_key in (None, '', key), 'Client credential override forbidden')
        runtime = original(requested=provider, explicit_api_key=key,
                           explicit_base_url=base_url, target_model=model)
        require(runtime.get('credential_pool') is None, 'Credential pool forbidden')
        require(runtime.get('provider') == provider, 'Resolved provider drift')
        require(str(runtime.get('base_url', '')).rstrip('/') == base_url, 'Resolved endpoint drift')
        require(runtime.get('api_key') == key, 'Resolved credential drift')
        return runtime
    return resolve

def restricted_adapter_class(base, runtime_guard):
    class RestrictedAdapter(base):
        _ary_draining = False

        def _http_route_table(self):
            routes = [r for r in super()._http_route_table() if (r[0], r[1]) in ALLOWED]
            require({(r[0], r[1]) for r in routes} == ALLOWED, 'Upstream route contract changed')
            return routes

        def _gateway_is_draining(self):
            return self._ary_draining

        def _create_agent(self, *args, **kwargs):
            require(not self._ary_draining, 'Worker draining')
            require(os.environ.get('ARY_HERMES_LOCAL_ACCEPTANCE') != '1', 'Inference disabled for local acceptance')
            runtime_guard()
            require(not kwargs.get('route') and not kwargs.get('room_dispatch') and not kwargs.get('room_execution_policy'), 'Client route/room overrides forbidden')
            agent = super()._create_agent(*args, **kwargs)
            # Upstream _execute_run calls run_conversation only AFTER this returns.
            validate_agent(agent)
            runtime_guard()  # Verify plugin discovery during constructor did not enable anything.
            return agent

        async def disconnect(self, drain_timeout=30.0):
            self._ary_draining = True
            if self._site:
                await self._site.stop()
                self._site = None
            # Use original stop bookkeeping so completed interruption is marked cancelled.
            self._stopping_run_ids.update(self._active_run_tasks)
            self.interrupt_active_runs('Ary worker shutting down')
            deadline = asyncio.get_running_loop().time() + drain_timeout
            while self.active_agent_work_count():
                self.interrupt_active_runs('Ary worker shutting down')
                if asyncio.get_running_loop().time() >= deadline:
                    # Do not close DB under live executor threads or falsely mark them finished.
                    raise ShutdownIncomplete('Run drain timed out; persisted state requires restart recovery')
                await asyncio.sleep(0.05)
            # Upstream orphan sweeper is background bookkeeping, not cron.
            tasks = list(getattr(self, '_background_tasks', ()))
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            await super().disconnect()
    return RestrictedAdapter

async def main():
    import yaml
    require(os.geteuid() != 0, 'Must run as non-root')
    require(os.environ.get('HERMES_IGNORE_RULES') == '1', 'Rules must be disabled')
    require(not os.environ.get('HERMES_SAFE_MODE') and not os.environ.get('HERMES_IGNORE_USER_CONFIG'), 'Config bypass forbidden')
    home = Path(os.environ['HERMES_HOME'])
    require(len(os.environ.get('API_SERVER_KEY', '')) >= 43, 'Provision a dedicated strong key')
    # Dedicated env file may contain ONLY the bearer plus the newly scoped model credential.
    provider_env = os.environ.get('ARY_HERMES_PROVIDER_KEY_ENV', '')
    require(provider_env in {'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY'}, 'Explicit reviewed provider credential required')
    local_acceptance = os.environ.get('ARY_HERMES_LOCAL_ACCEPTANCE') == '1'
    require(local_acceptance or bool(os.environ.get(provider_env)), 'Scoped model credential missing')
    if local_acceptance:
        require(not os.environ.get(provider_env), 'Local acceptance must not load a model credential')
    allowed_secrets = {'API_SERVER_KEY', provider_env}
    for name, value in os.environ.items():
        if value and (name.endswith('_API_KEY') or name.endswith('_TOKEN') or name.endswith('_PASSWORD')):
            require(name in allowed_secrets, 'Unexpected credential environment variable: ' + name)
    for filename in ('.env', 'auth.json', 'credentials.json'):
        require(not (home / filename).exists(), 'Unexpected additional credential file: ' + filename)
    raw = yaml.safe_load((home / 'config.yaml').read_text())
    validate_config(raw)
    # Install before importing gateway/API code, so their local imports use the same env-only path.
    # The official explicit-key resolver returns before load_pool; no auth-store exception is weakened.
    import hermes_cli.runtime_provider as runtime_provider
    runtime_provider.resolve_runtime_provider = env_only_resolver(
        runtime_provider.resolve_runtime_provider, provider=raw['model']['provider'],
        key_env=provider_env, model=raw['model']['default'], environ=os.environ)
    from hermes_cli.tools_config import _get_platform_tools
    from hermes_cli.plugins import PluginManager
    from gateway.config import PlatformConfig
    from gateway.platforms.api_server import APIServerAdapter

    def runtime_guard():
        raw = yaml.safe_load((home / 'config.yaml').read_text())
        validate_config(raw)
        require(_get_platform_tools(raw, 'api_server') == set(), 'Effective API tools not empty')
        manager = PluginManager()
        require(not any(p.enabled for p in manager._plugins.values()), 'Active plugin detected')
    runtime_guard()
    adapter = restricted_adapter_class(APIServerAdapter, runtime_guard)(PlatformConfig(enabled=True))
    stop = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(sig, stop.set)
    if not await adapter.connect():
        await adapter.disconnect()
        raise RuntimeError('API failed to start; inspect sanitized local logs')
    try:
        await stop.wait()
    finally:
        try:
            await adapter.disconnect()
        except ShutdownIncomplete:
            # Immediate non-success exit preserves durable running records for upstream recovery.
            # No false graceful-stop claim; container acceptance must test this path.
            os.write(2, b'Ary worker shutdown incomplete; restart recovery required\n')
            os._exit(70)

if __name__ == '__main__':
    asyncio.run(main())
