# Nexus Physical World v1

## Audit and implementation boundary

The pre-change audit found an existing `StudioService`, `StudioAdapter`, Amaran OpenAPI implementation, configured device/scene schema, scene conversation router, Studio panel and acceptance harness. `studio.inspect`, `studio.plan_scene` and `studio.execute_scene` already went through ToolRegistry, ActionRequestService, permissions, exact approvals, audit/outcomes and durable encrypted receipts. The mission engine already supported dependency bindings, approvals, read-back verification and restart recovery. Nexus already projected successful device inspection receipts and supported device/location node kinds. These systems were extended in place.

No second physical executor, permissions service, mission runtime, entity store or telemetry database was introduced. No schema migration or dependency change is needed. Existing hosted migration gates still apply to mission/event persistence. No live device settings, credentials, user policies or enable flags were changed.

## Technology evaluation

| Option                                                                          | Decision for v1                                 | Reason                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Home Assistant REST API](https://developers.home-assistant.io/docs/api/rest/)  | Add one restricted StudioAdapter                | Provides authenticated state reads and service calls. Ary exposes only configured light intensity/sleep settings, then separately reads state. Never uses the state-write endpoint to pretend hardware changed.  |
| [MQTT through Home Assistant](https://www.home-assistant.io/integrations/mqtt/) | Use behind Home Assistant when configured there | Reuses HA's MQTT discovery/availability mapping. No second broker client, arbitrary topic publisher or competing command path in Ary.                                                                            |
| [ESPHome native API](https://esphome.io/components/api/)                        | Use HA's supported ESPHome integration          | Native API supports device state/control; HA owns that connection. No firmware flashing, provisioning or unrestricted native service calls in Ary.                                                               |
| [Node-RED](https://nodered.org/docs/)                                           | Defer                                           | Its flow runtime would overlap durable Missions here. Do not expose arbitrary flows/webhooks that can bypass the reviewed scene.                                                                                 |
| Native integrations                                                             | Preserve Amaran                                 | The current adapter already supplies bounded fixed commands and provider-reported light state. Add other model-specific adapters to the same interface only after their capabilities and verification are known. |

These are architectural choices for this repository, not claims that every provider/device is connected. HA support is deliberately limited to light brightness and on/off (the existing `sleep` verb). Cameras, routing, prompters, displays and other equipment remain unconfigured until an appropriate adapter exists.

## Registry, locations, scenes and telemetry

`DeviceRegistry` validates and projects the existing owner-configured `StudioConfig`; stable device IDs remain unchanged. Optional `locations` support studio, home, office and `other` for future locations. Existing configs receive those three location descriptors; devices without a `location_id` belong to studio. Descriptors do not imply hardware presence. Optional canonical `entity_id` values reference the existing entity graph, without creating entities.

Optional device `position: {x, y}` uses 0–100 percentages. Unplaced devices use an explicitly schematic layout. The configuration limits remain 20 devices and 10 scenes; up to 30 locations. Inventory inspection has at most four device reads in flight and retries a failed inspection once. This recovery only re-establishes observation; it never replays a physical command, power-cycles a device or restarts an app.

Telemetry is collected on requested inspections and scene verification, not by a hidden always-on scanner. Observations retain device ID, timestamp, provider state, availability, capabilities and read-recovery evidence. A reading expires for readiness after 30 seconds. The UI marks it stale and offers the existing Inspect studio action to refresh it. No stale state is labelled live. Full observations are evidence in existing action outputs; meaningful `device.observed` and `device.readiness` events use the existing owner-scoped event bus, action correlation and mission IDs. Event payloads exclude tokens and raw provider responses.

`StudioReport` retains its original delivery status/step receipts and adds readiness evidence. `ready` requires fresh matching observations for every required scene target. Unavailable/mismatched targets are `not_ready`; missing verification fields or unverified presets are `unverified`. No required targets is also unverified. Every configured required target must be simultaneously true at completion; contradictory scene targets cannot report ready.

Numeric/sleep commands supply a default state target. Presets require an explicit `verify` map, such as `{"preset":"podcast"}`, supported by that device adapter's observations. Home Assistant's [light brightness contract](https://developers.home-assistant.io/docs/core/entity/light/) is quantized to its 1–255 scale for positive commands and mapped back to Ary's 0–1000 scale for comparison; zero explicitly turns the light off. Explicit `verify` targets are exact. Powered-off lights may have null brightness; supported color modes determine dimming capability. Read-back is provider evidence, not independent camera/physical proof. Matching lights alone never establish camera/audio readiness unless those requirements are explicitly configured and verified.

Command acknowledgement and readiness stay distinct. Mismatched successful deliveries produce a failure outcome; unverified successful deliveries produce a pending outcome. Uncertain delivery preserves the write-ahead lock, stops later writes and cannot become a ready execution report. Existing manual reconciliation requirements remain. Permission changes stop further writes and prevent final read-back where permission was revoked. No physical rollback is claimed.

## Podcast Mode and Missions

1. Tools → Studio → Inspect studio shows locations and observed devices.
2. Plan scene resolves the existing configured scene and binds its exact steps, config revision and observations.
3. Review and execute uses the existing exact approval dialog. Approval still applies even at numeric permission level 5.
4. Execution records individual device results, stops after uncertain delivery, preserves dependency skips, and performs fresh read-back.
5. Equipment readiness explains each matched, mismatched, unavailable or unverified requirement.
6. Create preparation mission sends the returned `mission_spec` through existing `mission.create`. It saves a DRAFT; it does not start equipment.
7. Open preparation mission uses existing Mission Control. Planning and starting causes the mission to prepare a fresh scene, wait for its equipment approval, execute, then verify with `studio.inspect({scene})`. Readiness must equal `ready` before COMPLETED.

The shared conversation router still recognizes “Ary, podcast mode” and queues the existing scene approval. No alternate voice brain or mission executor was added. The new mission template can also be used by the existing orchestrator with its standard `$from` bindings.

The Nexus map projects configured locations and `located_in`/canonical entity reference edges from saved inspection receipts. It performs no live network discovery. Device nodes remain labelled previously observed, and open Studio. Fresh backend events can connect mission/entity/tool/device IDs using the existing map event projection; no fabricated pulses or relationships.

## Configuration

Keep the existing Studio enablement: explicit `ARY_STUDIO_ENABLED=true`, configured `ARY_STUDIO_USER_ID`, Supabase storage, macOS and the authorized installed app local session. Planning/default inventory does not enable physical control. Set `ARY_STUDIO_CONFIG_PATH` to a reviewed config file. Existing `studio.example.json` demonstrates Amaran with locations and placement.

For Home Assistant, start from `studio.home-assistant.example.json` and configure an actual light entity. Put `ARY_HOME_ASSISTANT_URL` (origin only, e.g. `http://127.0.0.1:8123`) and `ARY_HOME_ASSISTANT_TOKEN` in the server environment. Both are blank in `.env.example`. For a network host, use trusted HTTPS where available. The token never reaches the UI or tool input. Requests reject redirects, URL credentials/path/query, unsupported entity domains/verbs and oversized responses; each request times out after four seconds. A post-dispatch error is uncertain, never automatically retried.

The example verifies lighting only. Add camera/audio/other required equipment with real model-specific adapters and verifiable targets before calling it full podcast readiness. Do not supply secrets or raw URLs as scene inputs. No HA server, broker, ESPHome device or Node-RED flow is automatically installed or contacted.

## Exact code changes

Added:

- `src/services/device-registry.ts`: validation/projection, bounded observations/read recovery, readiness evaluation.
- `src/infrastructure/studio/home-assistant.ts`: restricted environment-configured HA adapter.
- `src/domain/studio-mission.ts`: standard durable mission spec.
- `src/components/studio/studio-space.tsx`: locations, device placement, selection and timestamped telemetry.
- `tests/physical-world.test.ts`: isolated registry/adapter/mission acceptance.
- `studio.home-assistant.example.json`: unconnected light configuration example.
- This document.

Extended:

- `src/domain/studio.ts`: optional location, placement, entity binding, HA adapter, verification fields and readiness types.
- `src/services/studio-service.ts`: registry observations, optional scene read-back, final evidence while retaining the receipt/approval pipeline.
- `src/infrastructure/tools/studio-tools.ts`: optional inspect scene, mission template, real device events.
- `src/services/action-request-service.ts`: readiness in outcome evidence and truthful outcome status.
- `src/domain/nexus-map.ts`, `src/services/nexus-map-service.ts`, `src/components/atlas/map-projection.ts`: saved location/device projections and real-event linkage.
- `src/components/studio/studio-panel.tsx`, `studio.module.css`: spatial panel, readiness and Mission Control entry.
- `src/components/dashboard.tsx`: existing mission selection callback from Studio only.
- `scripts/lib/mission-fixture.ts`: optional StudioService injection into the current test fixture.
- `scripts/evaluate-studio.ts`: extend existing isolated browser flow with locations, spatial selection, readiness, Nexus links, mission draft navigation and reduced-motion checks.
- `.env.example`, `studio.example.json`, `README.md`, `ARY_NEXUS_ROADMAP.md`: setup and milestone evidence.

## Verification

September 9, 2026 final results:

| Check                                                            | Result                                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full suite, original timeouts (`npm run test -- --maxWorkers=1`) | **1,293 passed / 78 files**, 91.44 s                                                                                                                                                                                           |
| Physical World cases within that suite                           | **21 passed**, including a three-device Podcast mission, safe read recovery, exact approval, decline/denial, uncertain delivery, idempotency, read-back failure and real event/outcome linkage                                 |
| Typecheck (`npm run typecheck`)                                  | **Passed**                                                                                                                                                                                                                     |
| Production build (`npm run build`)                               | **Passed**, isolated mirror; existing desktop build untouched                                                                                                                                                                  |
| Browser (`npm run test:studio`)                                  | **14 passed**: Studio navigation, spatial selection, locations, telemetry, rejection/no effects, partial failure, dependency skip, outcome, replay safety, readiness, Nexus links, mission draft navigation and reduced motion |
| Source comparison                                                | All **17 modified/new runtime and verification source files** compared between repository and validation mirror matched                                                                                                        |
| Real hardware                                                    | **Pending configuration and live acceptance**; no device was enabled or contacted                                                                                                                                              |

The browser test used temporary local repository/vault fixtures and simulated device adapters, exercised the actual API/approval/Mission UI, and cleaned up its source, data, server and browser session. The three-device Podcast acceptance test used the real MissionEngine, ToolRegistry, permissions, action/outcome persistence and event bus with simulated light/camera/audio state. No real user account, cloud fixture or external effect was used. No schema migration or package change was made.

Earlier runs during severe host load (observed load average above 230) hit existing mission timing assertions and database setup timeouts. An extended-runner-timeout diagnostic was also not a clean pass. Those failures were retained in local logs and were **superseded by the final complete pass at the original timeouts**; no test assertions, source test timeouts or production deadline behavior were loosened. The old browser harness needed cold page **and API** compilation to finish before interaction timing began; its 25-second interaction assertions remain unchanged.

Local evidence: `/tmp/physical-default-final-suite.log`, `/tmp/physical-release-types.log`, `/tmp/physical-release-build.log`, `/tmp/physical-browser3.log`. The final formatting check is recorded in `/tmp/physical-release-format.log`. Earlier load-affected runs are `/tmp/physical-final-suite.log` and `/tmp/physical-functional-suite.log`.

## Remaining acceptance and limits

- Configure actual devices and room membership, inspect them, then run Podcast Mode through approval in the installed owner session. Verify camera/audio/light state physically and compare with the recorded read-back. A lighting-only example is not full studio readiness.
- Test a disconnected required device and a mismatched setting. Ary must report not ready and preserve evidence; it must not silently replay an uncertain write.
- Single configured owner/host and one Home Assistant origin; no broker, firmware, HA server or flow provisioning. HA lights and native Amaran are the implemented adapters. Other device models require a verified adapter.
- Telemetry is on demand, not a continuously subscribed HA/MQTT stream. UI observations expire after 30 seconds. Historical graph receipts do not assert current availability.
- Recovery is one safe inspection retry. Uncertain writes retain the existing manual reconciliation guard. Stop checks apply between device operations; already delivered commands are not undone.
- Previous hosted mission/event migration and native permission gates remain. Existing DONE statuses and NEXT 3 are preserved; no subsequent milestone started.
