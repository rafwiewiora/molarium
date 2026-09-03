import { rename, rm } from 'node:fs/promises';

/**
 * Publish a fully verified render directory in one rename. The caller must keep every movie,
 * manifest, audit, and QA frame inside stagingDirectory until complete is true.
 */
export async function promoteCompletedRender({ stagingDirectory, outputDirectory,
  complete } = {}) {
  if (complete !== true)
    throw new Error('Refusing to publish an incomplete interface render');
  if (typeof stagingDirectory !== 'string' || !stagingDirectory
    || typeof outputDirectory !== 'string' || !outputDirectory
    || stagingDirectory === outputDirectory)
    throw new Error('Render staging and output directories must be distinct paths');
  const backupDirectory = `${outputDirectory}.previous-${process.pid}-${Date.now()}`;
  let previousMoved = false;
  try {
    try {
      await rename(outputDirectory, backupDirectory);
      previousMoved = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try {
      await rename(stagingDirectory, outputDirectory);
    } catch (error) {
      if (previousMoved) await rename(backupDirectory, outputDirectory);
      throw error;
    }
    if (previousMoved) await rm(backupDirectory, { recursive:true, force:true }).catch(() => {});
    return outputDirectory;
  } catch (error) {
    throw new Error(`Interface render publication failed without accepting partial output: ${error.message}`,
      { cause:error });
  }
}
