# Map hosts

The protocol-v2 replay engine, caches, request coordinator, live interpolation,
telemetry reconstruction, range/timeline UI, preferences and authenticated chat
remain in one frontend under `bluemap-addon/src`. The directory name is retained
for build compatibility; these controllers do not depend on a map renderer.

`MapAdapter` accepts protocol coordinates (32 units per block) and owns markers,
trails, events, heatmap geometry, roster navigation and disposal. `ViewerHost`
supplies asset URLs, dimension mappings, map switching and adapter factories.
Register a host with `configureViewerHost` before mounting the replay panel.

`createBlueMapHost` preserves existing relative URLs and map IDs. Its 3D object
renderer loads only when history opens. The history runtime itself has no BlueMap
imports. A second host must convert coordinates exactly once at the rendering
boundary and preserve the core's segmented trails, unknown state and selection.

Public history and chat API paths/protocols are unchanged. No recorder migration,
retention change or deletion of recordings is required.
