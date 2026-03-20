// FileTreeView — Re-exports the relevant files scan viewer used as a file tree navigation component.
// The actual RelevantFilesScanView is co-located with other viewers in ArtifactContentViewer
// because it shares CollapsibleSection, CopyButton, and RawContentView without circular deps.
//
// This module serves as the public entry point for file-tree-oriented artifact viewing.

export { ArtifactContent as FileTreeArtifactContent } from './ArtifactContentViewer'
