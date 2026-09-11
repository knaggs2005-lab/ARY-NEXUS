# Static manifest checks only. Never reads env_file or resolves credential values.
require 'yaml'
root = File.dirname(__FILE__)
checks = 0
check = lambda do |condition, message|
  raise message unless condition
  checks += 1
end
compose = YAML.safe_load(File.read(File.join(root, 'compose.yaml')))
service = compose.fetch('services').fetch('hermes')
%w[entrypoint command cap_drop security_opt ports volumes tmpfs env_file].each do |name|
  check.call(service[name].is_a?(Array) && service[name].all? { |x| x.is_a?(String) }, "#{name} must be an array of strings")
end
check.call(service['tmpfs'] == ['/tmp:size=128m,noexec,nosuid,nodev'], 'tmpfs options must form one mount string')
check.call(service['security_opt'] == ['no-new-privileges:true'], 'security option must form one string')
check.call(service['ports'] == ['127.0.0.1:8642:8642'], 'host publication must be loopback only')
check.call(service['user'] == '10000:10000', 'non-root user must be explicit')
check.call(service['read_only'] == true, 'container filesystem must remain read-only')
check.call(service['cap_drop'] == ['ALL'], 'all Linux capabilities must be dropped')
check.call(service['labels']['traefik.enable'] == 'false', 'initial public exposure must remain off')
check.call(service['restart'] == 'no', 'no restart loop during acceptance')
check.call(service['stop_grace_period'] == '45s', 'Docker must allow the 30-second application drain')
check.call(service['image'].match?(/@sha256:[0-9a-f]{64}\z/), 'image must be immutable')
check.call(!service.key?('network_mode') && !service.key?('privileged'), 'no host networking/privileged mode')
check.call(service['volumes'].none? { |v| v.include?('docker.sock') }, 'worker must not mount Docker socket')
config = YAML.safe_load(File.read(File.join(root, 'config.local-acceptance.yaml')))
check.call(config['model']['provider'] == 'openai-api', 'Pinned Hermes OpenAI provider ID is openai-api, not openai')
check.call(config['auxiliary']['title_generation']['enabled'] == false, 'Automatic auxiliary title calls must be disabled')
check.call(config['compression']['enabled'] == false, 'Automatic auxiliary compression calls must be disabled')
check.call(config['platform_toolsets']['api_server'] == [], 'API allowlist must be empty')
check.call(config['plugins']['enabled'] == [], 'plugins must be disabled')
check.call(config['memory']['memory_enabled'] == false && config['memory']['user_profile_enabled'] == false, 'both memory stores must be disabled')
check.call(config['mcp_servers'] == {} && config['hooks'] == {}, 'MCP and hooks must be absent')
overlay = YAML.safe_load(File.read(File.join(root, 'traefik-exposure.yaml.example')))
check.call(overlay['services']['hermes']['labels'].values.all? { |v| v.is_a?(String) }, 'Traefik labels must be strings')
live_example = YAML.safe_load(File.read(File.join(root, 'config.openai-api.example.yaml')))
check.call(live_example['model'] == {'provider' => 'openai-api', 'default' => 'gpt-5.6-sol'}, 'Live example must use owner-selected model with verified provider ID')
check.call(live_example['auxiliary']['title_generation']['enabled'] == false && live_example['compression']['enabled'] == false, 'Live example must disable auxiliary title/compression requests')
puts "#{checks} static deployment YAML checks passed"
