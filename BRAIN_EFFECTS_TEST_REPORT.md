# Ary Brain Graph effects — verification

Date: 2026-09-06. Enhancement uses vgpu 0.4.0 behind the existing Canvas2D graph. No graph schema, API, database, or canonical IDs changed.

## Results

- **161 automated tests passed** across 15 files. Six new tests cover bounded instance packing, actual camera/position sharing, selected halo priority, viewport culling (including crossing paths), historical-edge suppression, event provenance/expiry, particle limits and quality downgrade policy.
- **TypeScript, production Next.js build, and formatting passed.** The adapter is dynamically imported only for Auto with motion enabled; shaders use vgpu's supported WGSL-string API.
- **Real GPU smoke test passed** on the Mac's Metal adapter. Both shaders compiled and rendered, including halo/pulse/particle instances. Pixel readback verified the halo center (alpha 48/255). No GPU validation errors. Repeat with `npm run test:brain-gpu` on a machine with GPU access.
- **Isolated browser fixture passed:** the actual React BrainCanvas/BrainEffects components rendered synthetic graph data under StrictMode; focus/fly-to, zoom, fit, Auto/Off, unmount/remount and reduced motion all worked without captured browser errors.
- **Fallback passed:** destroying the test GPU device hid the enhancement and showed Static while Fit continued working. Removing browser WebGPU availability produced Static with zero devices created. Off immediately hid/released the GPU layer. Re-enabling Auto restored it.
- **Creation signal passed:** a synthetic confirmed-save event added 12 short-lived particles (56 → 68 instances). Plain initial graph rendering generated no creation burst. Application hooks only notify after successful memory/relationship POST responses or chat extraction-complete events. No test memories were written to the user's database.
- **Bounded stress fixture:** 240 nodes / 900 edges, about 60.3 presented FPS when settled and 56.6 FPS during continuous wheel zoom, with GPU effects active and no browser errors. These are short local browser measurements, not cross-device performance guarantees.
- **Authenticated application checked:** the real workspace Brain Graph loaded its three entities and two relationships and displayed **GPU effects active** with the new Auto/Off control.

## Manual checks

1. Open Graph, leave Effects on Auto, and select/search Ary Nexus. Check the soft halo and relationship pulses follow the camera while text stays sharp.
2. Pan, zoom, fit, open/close the contextual panel, and resize the window. Graph and effects should stay aligned.
3. Switch Effects Off, navigate away and back, then restore Auto. The preference should persist; interactions should remain usable.
4. Enable OS reduced motion. The graph should become static and release the GPU context.
5. Create a memory or relationship, then open Graph within 15 seconds. Unlinked memories use a neutral bottom-of-view particle cue; relationships anchor to a visible endpoint. Loading/expanding alone should produce no creation particles.
6. On a browser without WebGPU, expect Static and the standard graph. No credentials, backend changes or GPU-specific graph data are needed.

## Limits

Visual checks used this Mac and an isolated browser fixture; mobile/low-end hardware and other browsers still need testing. Reduced-motion mode deliberately uses the existing static graph. Runtime quality monitors presented frame cadence rather than claiming GPU timestamp measurements. GPU shader tests require local hardware access; ordinary unit tests remain hardware-independent. No fullscreen HDR post-processing, simulation framework, or new integration was added.
