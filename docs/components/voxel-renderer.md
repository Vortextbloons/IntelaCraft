# Voxel Renderer

`services/voxel-renderer` is a dependency-free Go child process managed by the controller. It accepts versioned newline-delimited JSON requests on stdin and writes one correlated JSON response per line on stdout. Supported commands are `health`, `process_scene`, `render_image`, `generate_thumbnail`, and `compare_snapshots`.

Jobs are capped at 32,768 blocks and 2048×2048 output. Scene processing removes fully hidden blocks and reports visible face directions. Static rendering produces deterministic PNG files at controller-allocated paths; renderer input cannot select paths directly through the public API. The controller applies request timeouts, rejects failed jobs, restarts the process on a subsequent request after exit, and removes temporary render files older than one hour at startup.
