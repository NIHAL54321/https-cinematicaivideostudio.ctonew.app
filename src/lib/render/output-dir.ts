/**
 * WHERE THE RENDER PIPELINE WRITES — one answer, read from the deployment.
 *
 * The pipeline, the download centre and the "file is gone" sentence must name
 * the same directory. A hardcoded `/tmp/cavs-render-output` in a user-facing
 * sentence told a reader the wrong folder on a deployment that sets
 * `RENDER_OUTPUT_DIR` (this one renders to `/home/team/render-out`), so the
 * resolution lives here and everything that names it asks this function.
 */
export function renderOutputDir(): string {
  return process.env.RENDER_OUTPUT_DIR?.trim() || "/tmp/cavs-render-output";
}

/**
 * True when the directory sits under `/tmp`, the tmpfs-backed overlay a machine
 * reset wipes. A sentence may only say a reset wipes the output when this is
 * true — a directory on `/home` is not wiped by a reset.
 */
export function outputDirIsEphemeral(dir: string = renderOutputDir()): boolean {
  const trimmed = dir.replace(/\/+$/, "");
  return trimmed === "/tmp" || trimmed.startsWith("/tmp/");
}
