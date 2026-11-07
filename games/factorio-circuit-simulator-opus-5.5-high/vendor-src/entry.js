// Vendor entry: everything the simulator imports from npm, bundled into ../vendor/rete-bundle.js
export { NodeEditor, ClassicPreset } from 'rete';
export { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
export { ConnectionPlugin, ClassicFlow, Presets as ConnectionPresets, getSourceTarget } from 'rete-connection-plugin';
export { ReactPlugin, Presets as ReactPresets } from 'rete-react-plugin';
import React from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
export { React, createRoot };
export const html = htm.bind(React.createElement);
